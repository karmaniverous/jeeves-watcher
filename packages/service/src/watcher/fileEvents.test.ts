/**
 * @module watcher/fileEvents.test
 * The queue actions behind filtered events: create/modify/delete enqueues through the health wrapper, move-correlator hand-off, and the correlator's own callbacks.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentHashCache } from '../cache';
import type { WatchConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue, WatchEvent } from '../queue';
import { createMoveCorrelator, FileEventActions } from './fileEvents';
import { MoveCorrelator } from './MoveCorrelator';

vi.mock('./MoveCorrelator', () => ({
  MoveCorrelator: vi.fn(),
}));

/** A queue that runs each job at once and records its event. */
function runningQueue() {
  const events: WatchEvent[] = [];
  const queue = {
    enqueue: (event: WatchEvent, job: () => Promise<void>) => {
      events.push(event);
      void job();
    },
  } as unknown as EventQueue;
  return { queue, events };
}

const processor = {
  processFile: vi.fn(() => Promise.resolve()),
  deleteFile: vi.fn(() => Promise.resolve()),
  moveFile: vi.fn(() => Promise.resolve()),
};
const logger = pino({ level: 'silent' });
const wrap = vi.fn((fn: () => Promise<void>) => fn());

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileEventActions', () => {
  it('enqueues create, modify and delete through the wrapper, with the VCS hook', () => {
    const { queue, events } = runningQueue();
    const vcs: string[] = [];
    const actions = new FileEventActions({
      queue,
      processor: processor as unknown as DocumentProcessorInterface,
      logger,
      wrap,
      onVcsFileChange: (path, event) => vcs.push(`${event}:${path}`),
    });
    actions.added('/a', true);
    actions.changed('/a');
    actions.removed('/a');
    actions.flush();
    expect(events.map((e) => e.type)).toEqual(['create', 'modify', 'delete']);
    expect(wrap).toHaveBeenCalledTimes(3);
    expect(processor.processFile).toHaveBeenCalledTimes(2);
    expect(processor.deleteFile).toHaveBeenCalledWith('/a');
    expect(vcs).toEqual(['add:/a', 'change:/a', 'unlink:/a']);
  });

  it('enqueues a paired move once, with the VCS unlink and add (D62)', () => {
    const { queue, events } = runningQueue();
    const vcs: string[] = [];
    const actions = new FileEventActions({
      queue,
      processor: processor as unknown as DocumentProcessorInterface,
      logger,
      wrap,
      onVcsFileChange: (path, event) => vcs.push(`${event}:${path}`),
    });
    actions.moved('/old/a', '/new/a');
    expect(events).toEqual([
      { type: 'move', path: '/new/a', oldPath: '/old/a', priority: 'normal' },
    ]);
    expect(processor.moveFile).toHaveBeenCalledWith('/old/a', '/new/a');
    expect(vcs).toEqual(['unlink:/old/a', 'add:/new/a']);
  });

  it('hands adds after the scan and every unlink to the move correlator', () => {
    const { queue, events } = runningQueue();
    const correlator = {
      handleAdd: vi.fn(() => Promise.resolve()),
      handleUnlink: vi.fn(),
      flush: vi.fn(),
    };
    const actions = new FileEventActions({
      queue,
      processor: processor as unknown as DocumentProcessorInterface,
      logger,
      wrap,
      correlator: correlator as unknown as MoveCorrelator,
    });
    actions.added('/scan', false);
    actions.added('/live', true);
    actions.removed('/gone');
    actions.flush();
    expect(events.map((e) => `${e.type}:${e.path}`)).toEqual(['create:/scan']);
    expect(correlator.handleAdd).toHaveBeenCalledWith('/live');
    expect(correlator.handleUnlink).toHaveBeenCalledWith('/gone');
    expect(correlator.flush).toHaveBeenCalledOnce();
  });
});

describe('createMoveCorrelator', () => {
  const config = (enabled: boolean) =>
    ({
      paths: ['**'],
      moveDetection: { enabled, bufferMs: 100 },
    }) as WatchConfig;
  const cache = {} as ContentHashCache;

  it('is off without move detection or a content hash cache', () => {
    const { queue } = runningQueue();
    const deps = { queue, processor: processor as never, logger, wrap };
    expect(createMoveCorrelator(config(false), deps, cache)).toBeUndefined();
    expect(createMoveCorrelator(config(true), deps)).toBeUndefined();
  });

  it('wires move, delete and create callbacks to the queue', () => {
    const { queue, events } = runningQueue();
    const deps = { queue, processor: processor as never, logger, wrap };
    expect(createMoveCorrelator(config(true), deps, cache)).toBeDefined();
    const options = vi.mocked(MoveCorrelator).mock.calls[0][0];
    options.onMove('/old', '/new');
    options.onDelete('/d');
    options.onCreate('/c');
    expect(events).toEqual([
      { type: 'move', path: '/new', oldPath: '/old', priority: 'normal' },
      { type: 'delete', path: '/d', priority: 'normal' },
      { type: 'create', path: '/c', priority: 'normal' },
    ]);
    expect(processor.moveFile).toHaveBeenCalledWith('/old', '/new');
    expect(options).toMatchObject({ enabled: true, bufferMs: 100 });
  });
});

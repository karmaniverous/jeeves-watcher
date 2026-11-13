/**
 * @module app/pipeline
 * Builds the processing pipeline of one start: compiled rules, templates, helper introspection, state stores, the document processor, the queues and the VCS coordinator, and logs the configured rules' facet warnings. Extracted from `JeevesWatcher` (SRP). I/O: reads templates and helpers, opens the state stores, reads the payload indexes.
 */

import type pino from 'pino';

import {
  checkFacetConfig,
  type FacetConfigCheckDeps,
} from '../api/catalog/facetWarnings';
import type { JeevesWatcherConfig } from '../config/types';
import type { AllHelpersIntrospection } from '../helpers';
import type { WatcherProcessor } from '../processor';
import { resolveProcessingLimits } from '../processor/processingLimits';
import type { EventQueue } from '../queue';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { JeevesWatcherFactories } from './factories';
import {
  buildTemplateEngineAndCustomMapLib,
  createProcessorConfig,
  getConfigDir,
  introspectHelpers,
} from './initialization';
import { createQueues } from './queues';
import { createSourceRetriever } from './sources';
import { createStateStores, type StateStores } from './stateStores';

/** The processor's construction options. */
type ProcessorOptions = Parameters<
  JeevesWatcherFactories['createDocumentProcessor']
>[0];

/** What {@link buildPipeline} needs. */
export interface PipelineInputs {
  config: JeevesWatcherConfig;
  configPath?: string;
  factories: JeevesWatcherFactories;
  logger: pino.Logger;
  embeddingProvider: ProcessorOptions['embeddingProvider'];
  vectorStore: ProcessorOptions['vectorStore'];
  /** The live config (read per document and by the VCS coordinator). */
  getConfig: () => JeevesWatcherConfig;
  /** Reads the payload indexes for the facet field check (D206 (4)). */
  facetStore?: FacetConfigCheckDeps['facetStore'];
}

/** The pipeline of one start. */
export interface Pipeline {
  helperIntrospection: AllHelpersIntrospection;
  stores: StateStores;
  processor: WatcherProcessor;
  queue: EventQueue;
  sourceQueue?: SourceNotifyQueue;
  vcsCoordinator: VcsCoordinator;
}

/**
 * Build the processing pipeline: rules, templates, processor, queues, VCS.
 *
 * @param inputs - Config, factories, logger, embedding and vector store.
 * @returns The pipeline's parts.
 */
export async function buildPipeline(inputs: PipelineInputs): Promise<Pipeline> {
  const { config, factories, logger, getConfig } = inputs;
  const compiledRules = factories.compileRules(config.inferenceRules ?? []);
  const configDir = getConfigDir(inputs.configPath);
  const { templateEngine, customMapLib } =
    await buildTemplateEngineAndCustomMapLib(config, configDir);
  const helperIntrospection = await introspectHelpers(config, configDir);
  const stores = createStateStores(config, logger);
  const processor = factories.createDocumentProcessor({
    config: createProcessorConfig(config, configDir, customMapLib),
    embeddingProvider: inputs.embeddingProvider,
    vectorStore: inputs.vectorStore,
    compiledRules,
    logger,
    templateEngine,
    ...stores,
    sourceRetriever: createSourceRetriever(config),
    // Read per document, so a reload applies to the next one (D44).
    getProcessingLimits: () => resolveProcessingLimits(getConfig()),
  });
  // Facet config warnings of the configured rules (D206 (3), (4)).
  await checkFacetConfig({
    config,
    configDir,
    facetStore: inputs.facetStore,
    logger,
  });
  const { queue, sourceQueue } = createQueues(config, factories, processor, {
    logger,
    issues: stores.issuesManager,
  });
  return {
    helperIntrospection,
    stores,
    processor,
    queue,
    sourceQueue,
    vcsCoordinator: new VcsCoordinator(config, logger, getConfig),
  };
}

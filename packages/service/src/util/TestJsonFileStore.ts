/**
 * @module util/TestJsonFileStore
 * Concrete test subclass of JsonFileStore for use in tests.
 */

import { JsonFileStore, type JsonFileStoreOptions } from './JsonFileStore';

interface TestData {
  items: string[];
}

export class TestJsonFileStore extends JsonFileStore<TestData> {
  // Public constructor to expose protected parent constructor for testing
  public constructor(options: JsonFileStoreOptions) {
    super(options);
  }

  protected createEmpty(): TestData {
    return { items: [] };
  }

  doLoad(): TestData {
    return this.load();
  }

  doSave(): void {
    this.save();
  }

  setCache(data: TestData): void {
    this.cache = data;
  }
}

export type { TestData };

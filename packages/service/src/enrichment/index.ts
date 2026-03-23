/**
 * @module enrichment
 * Enrichment metadata persistence and merge utilities. Re-exports EnrichmentStore and mergeEnrichment.
 */

export {
  EnrichmentStore,
  type EnrichmentStoreInterface,
} from './EnrichmentStore';
export { mergeEnrichment } from './merge';

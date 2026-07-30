import type {
  HybridSearchSettings,
  IndexedFileState,
  PersistedIndexState,
} from '../types';
import { INDEX_SCHEMA_VERSION } from '../types';

export const RECONCILIATION_MTIME_TOLERANCE_MS = 1;

export function newIndexState(
  settings: HybridSearchSettings,
): PersistedIndexState {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    embeddingBackend: settings.embeddingBackend,
    embeddingModel: settings.embeddingModel,
    embeddingDtype: settings.embeddingDtype,
    chunkSize: settings.chunkSize,
    chunkOverlap: settings.chunkOverlap,
    indexedFolders: [...settings.indexedFolders].sort(),
    excludePatterns: [...settings.excludePatterns].sort(),
    files: {},
  };
}

export function indexStateIsCompatible(
  state: PersistedIndexState,
  settings: HybridSearchSettings,
): boolean {
  const expected = newIndexState(settings);
  return state.schemaVersion === expected.schemaVersion
    && state.embeddingBackend === expected.embeddingBackend
    && state.embeddingModel === expected.embeddingModel
    && (
      state.embeddingDtype === undefined
      || state.embeddingDtype === expected.embeddingDtype
    )
    && state.chunkSize === expected.chunkSize
    && state.chunkOverlap === expected.chunkOverlap
    && JSON.stringify(state.indexedFolders) === JSON.stringify(expected.indexedFolders)
    && JSON.stringify(state.excludePatterns) === JSON.stringify(expected.excludePatterns);
}

export function expectedPassageCount(state: PersistedIndexState): number {
  return Object.values(state.files).reduce(
    (total, file) => total + file.passageIds.length,
    0,
  );
}

export function persistedIndexIsUsable(
  state: PersistedIndexState | null,
  settings: HybridSearchSettings,
  collectionDocumentCount: number,
): boolean {
  return state !== null
    && indexStateIsCompatible(state, settings)
    && expectedPassageCount(state) === collectionDocumentCount;
}

export function storedFileMetadataHasChanged(
  saved: Pick<IndexedFileState, 'mtime' | 'size'> | undefined,
  currentMtime: number,
  currentSize: number,
  mtimeToleranceMs = 0,
): boolean {
  return saved === undefined
    || saved.size !== currentSize
    || Math.abs(saved.mtime - Math.trunc(currentMtime)) > mtimeToleranceMs;
}

export const INDEX_SCHEMA_VERSION = 2;
export const EMBEDDING_DIMENSION = 384;
export const ROOT_FOLDER = '/';

export type SearchMode = 'hybrid' | 'keyword' | 'semantic';
export type MatchMode = 'all' | 'any' | 'phrase';
export type SortOrder =
  | 'relevance'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc'
  | 'title-asc'
  | 'title-desc';
export type ResultGrouping = 'notes' | 'passages';
export type EmbeddingBackend = 'minilm' | 'hash';

export interface HybridSearchSettings {
  indexedFolders: string[];
  excludePatterns: string[];
  autoIndex: boolean;
  chunkSize: number;
  chunkOverlap: number;
  embeddingBackend: EmbeddingBackend;
  embeddingModel: string;
  embeddingDtype: 'q4' | 'fp16' | 'fp32';
  embeddingBatchSize: number;
  defaultMode: SearchMode;
  defaultMatchMode: MatchMode;
  defaultSort: SortOrder;
  defaultGrouping: ResultGrouping;
  resultLimit: number;
  candidateLimit: number;
  titleBoost: number;
}

export const DEFAULT_SETTINGS: HybridSearchSettings = {
  indexedFolders: [ROOT_FOLDER],
  excludePatterns: ['.trash/**', '.obsidian/**'],
  autoIndex: true,
  chunkSize: 1200,
  chunkOverlap: 160,
  embeddingBackend: 'minilm',
  embeddingModel: 'onnx-community/all-MiniLM-L6-v2-ONNX',
  embeddingDtype: 'q4',
  embeddingBatchSize: 16,
  defaultMode: 'hybrid',
  defaultMatchMode: 'all',
  defaultSort: 'relevance',
  defaultGrouping: 'notes',
  resultLimit: 20,
  candidateLimit: 500,
  titleBoost: 0.35,
};

export interface Passage {
  id: string;
  path: string;
  title: string;
  heading: string;
  content: string;
  searchText: string;
  titleText: string;
  preview: string;
  tags: string[];
  folder: string;
  startLine: number;
  chunkIndex: number;
  mtime: number;
  ctime: number;
}

export interface IndexedFileState {
  mtime: number;
  size: number;
  passageIds: string[];
}

export interface PersistedIndexState {
  schemaVersion: number;
  embeddingBackend: EmbeddingBackend;
  embeddingModel: string;
  embeddingDtype?: HybridSearchSettings['embeddingDtype'];
  chunkSize: number;
  chunkOverlap: number;
  indexedFolders: string[];
  excludePatterns: string[];
  files: Record<string, IndexedFileState>;
  pendingPaths?: string[];
}

export type IndexPhase =
  | 'idle'
  | 'loading'
  | 'downloading-runtime'
  | 'scanning'
  | 'downloading-model'
  | 'embedding'
  | 'writing'
  | 'optimizing'
  | 'ready'
  | 'cancelled'
  | 'error';

export interface IndexStatus {
  phase: IndexPhase;
  message: string;
  completed: number;
  total: number;
  filesIndexed: number;
  passagesIndexed: number;
  background?: boolean;
  error?: string;
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  matchMode: MatchMode;
  sort: SortOrder;
  grouping: ResultGrouping;
  limit: number;
  modifiedFrom?: number;
  modifiedTo?: number;
}

export interface SearchResult {
  id: string;
  path: string;
  title: string;
  heading: string;
  preview: string;
  startLine: number;
  mtime: number;
  ctime: number;
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  elapsedMs: number;
}

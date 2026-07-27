import {
  DEFAULT_SETTINGS,
  ROOT_FOLDER,
  type HybridSearchSettings,
} from './types';

const SEARCH_MODES = new Set(['hybrid', 'keyword', 'semantic']);
const MATCH_MODES = new Set(['all', 'any', 'phrase']);
const SORT_ORDERS = new Set([
  'relevance',
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'title-asc',
  'title-desc',
]);
const GROUPINGS = new Set(['notes', 'passages']);
const BACKENDS = new Set(['minilm', 'hash']);
const DTYPES = new Set(['q4', 'fp16', 'fp32']);

export function parseTopLevelFolders(value: string): string[] {
  return [...new Set(value
    .split(/\r?\n/)
    .map((line) => line
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '')
      .split('/')[0] ?? '')
    .filter((folder) => folder && folder !== '.' && !folder.startsWith('.')))]
    .sort((a, b) => a.localeCompare(b));
}

export function normalizeSettings(raw: unknown): HybridSearchSettings {
  const saved = isRecord(raw) ? raw : {};
  return {
    indexedFolders: stringList(saved.indexedFolders, [ROOT_FOLDER], 100),
    excludePatterns: stringList(
      saved.excludePatterns,
      DEFAULT_SETTINGS.excludePatterns,
      200,
    ),
    autoIndex: booleanValue(saved.autoIndex, DEFAULT_SETTINGS.autoIndex),
    chunkSize: integerValue(saved.chunkSize, 600, 2400, DEFAULT_SETTINGS.chunkSize),
    chunkOverlap: integerValue(
      saved.chunkOverlap,
      0,
      400,
      DEFAULT_SETTINGS.chunkOverlap,
    ),
    embeddingBackend: enumValue(
      saved.embeddingBackend,
      BACKENDS,
      DEFAULT_SETTINGS.embeddingBackend,
    ),
    embeddingModel: boundedString(
      saved.embeddingModel,
      DEFAULT_SETTINGS.embeddingModel,
      200,
    ),
    embeddingDtype: enumValue(
      saved.embeddingDtype,
      DTYPES,
      DEFAULT_SETTINGS.embeddingDtype,
    ),
    embeddingBatchSize: integerValue(
      saved.embeddingBatchSize,
      1,
      64,
      DEFAULT_SETTINGS.embeddingBatchSize,
    ),
    defaultMode: enumValue(
      saved.defaultMode,
      SEARCH_MODES,
      DEFAULT_SETTINGS.defaultMode,
    ),
    defaultMatchMode: enumValue(
      saved.defaultMatchMode,
      MATCH_MODES,
      DEFAULT_SETTINGS.defaultMatchMode,
    ),
    defaultSort: enumValue(
      saved.defaultSort,
      SORT_ORDERS,
      DEFAULT_SETTINGS.defaultSort,
    ),
    defaultGrouping: enumValue(
      saved.defaultGrouping,
      GROUPINGS,
      DEFAULT_SETTINGS.defaultGrouping,
    ),
    resultLimit: integerValue(
      saved.resultLimit,
      1,
      100,
      DEFAULT_SETTINGS.resultLimit,
    ),
    candidateLimit: integerValue(
      saved.candidateLimit,
      10,
      2000,
      DEFAULT_SETTINGS.candidateLimit,
    ),
    titleBoost: numberValue(
      saved.titleBoost,
      0,
      1,
      DEFAULT_SETTINGS.titleBoost,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function stringList(
  value: unknown,
  fallback: string[],
  maxItems: number,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result = [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems))];
  return result.length > 0 ? result : [...fallback];
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integerValue(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Math.round(numberValue(value, minimum, maximum, fallback));
}

function numberValue(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<string>,
  fallback: T,
): T {
  return typeof value === 'string' && allowed.has(value)
    ? value as T
    : fallback;
}

import type { ZVecDoc } from '@zvec/zvec';
import type {
  HybridSearchSettings,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../types';
import { queryTerms } from './text';
import { LocalEmbeddingService } from './embeddings';
import { ZVecStore } from './zvec-store';

export class HybridSearchEngine {
  constructor(
    private readonly store: ZVecStore,
    private readonly embeddings: LocalEmbeddingService,
    private readonly settings: () => HybridSearchSettings,
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const started = performance.now();
    const query = request.query.trim().slice(0, 1000);
    if (!query) return { results: [], total: 0, elapsedMs: 0 };

    const settings = this.settings();
    const resultLimit = clampInteger(request.limit, 1, 100);
    const candidateLimit = clampInteger(
      Math.max(resultLimit, settings.candidateLimit),
      resultLimit,
      2000,
    );
    let docs: ZVecDoc[] = [];
    let lexicalDocs: ZVecDoc[] = [];
    let semanticDocs: ZVecDoc[] = [];

    if (request.mode === 'keyword') {
      docs = await this.store.keywordQuery(
        query,
        request.matchMode,
        candidateLimit,
      );
      lexicalDocs = docs;
    } else {
      const [queryVector] = await this.embeddings.embed([query]);
      if (!queryVector) throw new Error('The embedding model returned no query vector.');

      if (request.mode === 'semantic') {
        docs = await this.store.semanticQuery(queryVector, candidateLimit);
        semanticDocs = docs;
      } else {
        const [contentDocs, titleDocs, vectorDocs] = await Promise.all([
          this.store.keywordQuery(query, request.matchMode, candidateLimit),
          this.store.keywordQuery(
            query,
            request.matchMode,
            Math.max(50, Math.floor(candidateLimit / 2)),
            'titleText',
          ),
          this.store.semanticQuery(queryVector, candidateLimit),
        ]);
        lexicalDocs = contentDocs;
        semanticDocs = vectorDocs;
        docs = reciprocalRankFusion(
          [contentDocs, titleDocs, vectorDocs],
          candidateLimit,
        );

        if (request.matchMode !== 'any') {
          const requiredIds = new Set(lexicalDocs.map((doc) => doc.id));
          docs = docs.filter((doc) => requiredIds.has(doc.id));
        }
      }
    }

    const lexicalScores = scoreMap(lexicalDocs);
    const semanticScores = scoreMap(semanticDocs);
    const maxScore = Math.max(1e-9, ...docs.map((doc) => doc.score));
    const terms = queryTerms(query).map((term) => term.toLocaleLowerCase());

    let results = docs.map((doc) => {
      const result = toSearchResult(doc);
      const titleHaystack = `${result.title} ${result.heading}`.toLocaleLowerCase();
      const titleCoverage = terms.length === 0
        ? 0
        : terms.filter((term) => titleHaystack.includes(term)).length / terms.length;
      result.score = (doc.score / maxScore) + (settings.titleBoost * titleCoverage);
      result.lexicalScore = lexicalScores.get(doc.id);
      result.semanticScore = semanticScores.get(doc.id);
      return result;
    });
    const maxRelevance = Math.max(1e-9, ...results.map((result) => result.score));
    for (const result of results) result.score /= maxRelevance;

    if (request.grouping === 'notes') results = bestPassagePerNote(results);
    sortResults(results, request.sort);
    const total = results.length;
    results = results.slice(0, resultLimit);

    return {
      results,
      total,
      elapsedMs: performance.now() - started,
    };
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function reciprocalRankFusion(
  resultLists: ZVecDoc[][],
  limit: number,
  rankConstant = 60,
): ZVecDoc[] {
  const fused = new Map<string, { doc: ZVecDoc; score: number }>();
  for (const docs of resultLists) {
    docs.forEach((doc, index) => {
      const current = fused.get(doc.id) ?? { doc, score: 0 };
      current.score += 1 / (rankConstant + index + 1);
      fused.set(doc.id, current);
    });
  }
  return [...fused.values()]
    .sort((a, b) => (b.score - a.score) || a.doc.id.localeCompare(b.doc.id))
    .slice(0, limit)
    .map(({ doc, score }) => ({ ...doc, score }));
}

function scoreMap(docs: ZVecDoc[]): Map<string, number> {
  const max = Math.max(1e-9, ...docs.map((doc) => doc.score));
  return new Map(docs.map((doc) => [doc.id, doc.score / max]));
}

function toSearchResult(doc: ZVecDoc): SearchResult {
  const fields = doc.fields;
  return {
    id: doc.id,
    path: String(fields.path ?? ''),
    title: String(fields.title ?? fields.path ?? ''),
    heading: String(fields.heading ?? ''),
    preview: String(fields.preview ?? ''),
    startLine: Number(fields.startLine ?? 0),
    mtime: Number(fields.mtime ?? 0),
    ctime: Number(fields.ctime ?? 0),
    score: doc.score,
  };
}

function bestPassagePerNote(results: SearchResult[]): SearchResult[] {
  const byPath = new Map<string, SearchResult>();
  for (const result of results) {
    const current = byPath.get(result.path);
    if (!current || result.score > current.score) byPath.set(result.path, result);
  }
  return [...byPath.values()];
}

function sortResults(results: SearchResult[], sort: SearchRequest['sort']): void {
  const byRelevance = (a: SearchResult, b: SearchResult): number =>
    (b.score - a.score) || a.path.localeCompare(b.path);
  const sorters: Record<SearchRequest['sort'], (a: SearchResult, b: SearchResult) => number> = {
    relevance: byRelevance,
    'modified-desc': (a, b) => (b.mtime - a.mtime) || byRelevance(a, b),
    'modified-asc': (a, b) => (a.mtime - b.mtime) || byRelevance(a, b),
    'created-desc': (a, b) => (b.ctime - a.ctime) || byRelevance(a, b),
    'created-asc': (a, b) => (a.ctime - b.ctime) || byRelevance(a, b),
    'title-asc': (a, b) => a.title.localeCompare(b.title) || byRelevance(a, b),
    'title-desc': (a, b) => b.title.localeCompare(a.title) || byRelevance(a, b),
  };
  results.sort(sorters[sort]);
}

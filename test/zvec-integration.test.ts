import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalEmbeddingService, hashEmbedding } from '../src/search/embeddings';
import { HybridSearchEngine } from '../src/search/engine';
import { chunkMarkdown } from '../src/search/text';
import { ZVecStore } from '../src/search/zvec-store';
import { DEFAULT_SETTINGS } from '../src/types';

test('all-terms mode filters keyword and hybrid candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-obsidian-test-'));
  const store = new ZVecStore(join(directory, 'collection'));
  await store.open();
  try {
    const passages = [
      ...chunkMarkdown({
        path: 'Both.md',
        markdown: '# Both\n\nalpha beta gamma',
        chunkSize: 1200,
        chunkOverlap: 0,
        tags: [],
        mtime: 2,
        ctime: 1,
      }),
      ...chunkMarkdown({
        path: 'One.md',
        markdown: '# One\n\nalpha gamma only',
        chunkSize: 1200,
        chunkOverlap: 0,
        tags: [],
        mtime: 2,
        ctime: 1,
      }),
    ];
    await store.upsert(
      passages,
      passages.map((passage) => hashEmbedding(passage.searchText)),
    );
    const embeddings = new LocalEmbeddingService(
      join(directory, 'models'),
      'hash',
      'unused',
      'q4',
      () => undefined,
    );
    const settings = {
      ...DEFAULT_SETTINGS,
      embeddingBackend: 'hash' as const,
      candidateLimit: 20,
    };
    const engine = new HybridSearchEngine(store, embeddings, () => settings);
    try {
      for (const mode of ['keyword', 'hybrid'] as const) {
        const response = await engine.search({
          query: 'alpha beta',
          mode,
          matchMode: 'all',
          sort: 'relevance',
          grouping: 'notes',
          limit: 10,
        });
        assert.deepEqual(response.results.map((result) => result.path), ['Both.md']);
      }

      const anyTerms = await engine.search({
        query: 'alpha beta',
        mode: 'keyword',
        matchMode: 'any',
        sort: 'relevance',
        grouping: 'notes',
        limit: 10,
      });
      assert.deepEqual(
        new Set(anyTerms.results.map((result) => result.path)),
        new Set(['Both.md', 'One.md']),
      );
    } finally {
      await embeddings.dispose();
    }
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('ZVec upserts and deletes are searchable without optimize', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-obsidian-update-test-'));
  const store = new ZVecStore(join(directory, 'collection'));
  await store.open();
  try {
    const original = chunkMarkdown({
      path: 'Changing.md',
      markdown: '# Changing\n\noriginalword',
      chunkSize: 1200,
      chunkOverlap: 0,
      tags: [],
      mtime: 1,
      ctime: 1,
    });
    await store.upsert(
      original,
      original.map((passage) => hashEmbedding(passage.searchText)),
    );
    assert.equal((await store.keywordQuery('originalword', 'all', 10)).length, 1);

    const replacement = chunkMarkdown({
      path: 'Changing.md',
      markdown: '# Changing\n\nreplacementword',
      chunkSize: 1200,
      chunkOverlap: 0,
      tags: [],
      mtime: 2,
      ctime: 1,
    });
    await store.deletePath('Changing.md');
    await store.upsert(
      replacement,
      replacement.map((passage) => hashEmbedding(passage.searchText)),
    );
    assert.equal((await store.keywordQuery('originalword', 'all', 10)).length, 0);
    assert.equal((await store.keywordQuery('replacementword', 'all', 10)).length, 1);

    await store.deletePath('Changing.md');
    assert.equal((await store.keywordQuery('replacementword', 'all', 10)).length, 0);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

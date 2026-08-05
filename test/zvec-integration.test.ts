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

test('later Markdown headings are retrievable through ZVec', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-obsidian-heading-test-'));
  const store = new ZVecStore(join(directory, 'collection'));
  await store.open();
  try {
    const passages = chunkMarkdown({
      path: '2026-07-27.md',
      markdown: [
        '## AudioCodes Live Platform / LivePlatform',
        '',
        'Login details',
        '',
        '## AudioCodes Support',
        '',
        'Support portal details',
      ].join('\n'),
      chunkSize: 1200,
      chunkOverlap: 160,
      tags: [],
      mtime: 2,
      ctime: 1,
    });
    await store.upsert(
      passages,
      passages.map((passage) => hashEmbedding(passage.searchText)),
    );

    const matches = await store.keywordQuery('AudioCodes Support', 'all', 10);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.fields.path, '2026-07-27.md');
    assert.equal(matches[0]?.fields.heading, 'AudioCodes Support');
    assert.equal(matches[0]?.fields.startLine, 4);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('search can return the complete ranked set for client-side paging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-obsidian-paging-test-'));
  const store = new ZVecStore(join(directory, 'collection'));
  await store.open();
  try {
    const passages = Array.from({ length: 35 }, (_, index) => chunkMarkdown({
      path: `AudioCodes ${index + 1}.md`,
      markdown: `# AudioCodes ${index + 1}\n\nAudioCodes support case ${index + 1}`,
      chunkSize: 1200,
      chunkOverlap: 0,
      tags: [],
      mtime: index + 1,
      ctime: 1,
    })).flat();
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
      candidateLimit: 50,
    };
    const engine = new HybridSearchEngine(store, embeddings, () => settings);
    try {
      const response = await engine.search({
        query: 'audiocodes support',
        mode: 'keyword',
        matchMode: 'all',
        sort: 'relevance',
        grouping: 'notes',
        limit: settings.candidateLimit,
      });
      assert.equal(response.total, 35);
      assert.equal(response.results.length, 35);
    } finally {
      await embeddings.dispose();
    }
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('modified-date bounds filter every search mode before ranking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-obsidian-date-test-'));
  const store = new ZVecStore(join(directory, 'collection'));
  await store.open();
  try {
    const passages = [100, 200, 300].flatMap((mtime) => chunkMarkdown({
      path: `Dated ${mtime}.md`,
      markdown: `# Dated ${mtime}\n\ndaterangemarker`,
      chunkSize: 1200,
      chunkOverlap: 0,
      tags: [],
      mtime,
      ctime: 1,
    }));
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
      for (const mode of ['keyword', 'semantic', 'hybrid'] as const) {
        const response = await engine.search({
          query: 'daterangemarker',
          mode,
          matchMode: 'all',
          sort: 'relevance',
          grouping: 'notes',
          limit: 10,
          modifiedFrom: 150,
          modifiedTo: 250,
        });
        assert.deepEqual(
          response.results.map((result) => result.path),
          ['Dated 200.md'],
        );
      }
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

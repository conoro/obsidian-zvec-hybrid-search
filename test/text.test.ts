import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkMarkdown,
  markdownToPlainText,
  matchesGlob,
  queryTerms,
} from '../src/search/text';
import { hashEmbedding } from '../src/search/embeddings';

test('heading-aware chunking produces stable searchable passages', () => {
  const passages = chunkMarkdown({
    path: 'Projects/Search.md',
    markdown: [
      '---',
      'status: active',
      '---',
      '# Search design',
      '',
      'Alpha and beta belong in the same result.',
      '',
      '## Ranking',
      '',
      'Semantic ranking improves discovery.',
    ].join('\n'),
    chunkSize: 70,
    chunkOverlap: 10,
    tags: ['#search'],
    mtime: 100,
    ctime: 50,
  });

  assert.ok(passages.length >= 2);
  assert.equal(passages[0]?.title, 'Search');
  assert.match(passages[0]?.searchText ?? '', /Alpha and beta/);
  assert.equal(passages[0]?.id, chunkMarkdown({
    path: 'Projects/Search.md',
    markdown: '# Search design\n\nAlpha and beta belong in the same result.',
    chunkSize: 70,
    chunkOverlap: 10,
    tags: [],
    mtime: 200,
    ctime: 100,
  })[0]?.id);
});

test('Markdown cleanup and query parsing preserve useful text', () => {
  assert.equal(
    markdownToPlainText('A [[Target|useful label]] and **bold** term.'),
    'A useful label and bold term.',
  );
  assert.deepEqual(queryTerms('"exact phrase" alpha beta'), [
    'exact phrase',
    'alpha',
    'beta',
  ]);
});

test('vault-relative glob matching supports single and recursive stars', () => {
  assert.equal(matchesGlob('.trash/old/note.md', '.trash/**'), true);
  assert.equal(matchesGlob('Projects/one.md', 'Projects/*.md'), true);
  assert.equal(matchesGlob('Projects/nested/one.md', 'Projects/*.md'), false);
});

test('hash embeddings are deterministic and normalized', () => {
  const first = hashEmbedding('hybrid note search');
  const second = hashEmbedding('hybrid note search');
  assert.deepEqual(first, second);
  const norm = Math.sqrt(first.reduce((sum, value) => sum + (value * value), 0));
  assert.ok(Math.abs(norm - 1) < 1e-5);
});


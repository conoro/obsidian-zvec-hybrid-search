import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkMarkdown,
  frontmatterToSearchText,
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

test('each Markdown heading starts a searchable passage', () => {
  const passages = chunkMarkdown({
    path: '2026-07-27.md',
    markdown: [
      '# Daily note',
      '',
      'General notes.',
      '',
      '## AudioCodes Live Platform / LivePlatform',
      '',
      '- Login details',
      '',
      '## AudioCodes Support',
      '',
      '- Support portal details',
    ].join('\n'),
    chunkSize: 1200,
    chunkOverlap: 160,
    tags: [],
    mtime: 100,
    ctime: 50,
  });

  assert.deepEqual(
    passages.map(({ heading }) => heading),
    [
      'Daily note',
      'AudioCodes Live Platform / LivePlatform',
      'AudioCodes Support',
    ],
  );
  const supportPassage = passages.find(
    ({ heading }) => heading === 'AudioCodes Support',
  );
  assert.match(supportPassage?.searchText ?? '', /AudioCodes Support/);
  assert.match(supportPassage?.content ?? '', /Support portal details/);
  assert.equal(supportPassage?.startLine, 8);
});

test('a heading without body text remains searchable', () => {
  const passages = chunkMarkdown({
    path: 'Headings.md',
    markdown: '## Empty but important heading',
    chunkSize: 1200,
    chunkOverlap: 160,
    tags: [],
    mtime: 100,
    ctime: 50,
  });

  assert.equal(passages.length, 1);
  assert.equal(passages[0]?.heading, 'Empty but important heading');
  assert.match(passages[0]?.searchText ?? '', /Empty but important heading/);
  assert.equal(passages[0]?.startLine, 0);
});

test('heading line numbers include stripped frontmatter', () => {
  const passages = chunkMarkdown({
    path: 'Frontmatter.md',
    markdown: [
      '---',
      'created: today',
      'category: support',
      '---',
      '## AudioCodes Support',
      '',
      'Support portal details',
    ].join('\n'),
    chunkSize: 1200,
    chunkOverlap: 160,
    tags: [],
    mtime: 100,
    ctime: 50,
  });

  assert.equal(passages[0]?.heading, 'AudioCodes Support');
  assert.equal(passages[0]?.startLine, 4);
});

test('frontmatter values become a bounded searchable Properties passage', () => {
  const frontmatter = {
    title: 'A clipped article',
    author: ['[[Steve Yegge]]'],
    published: '2026-08-05',
    details: { publication: 'Example Weekly' },
    position: { start: { line: 0 }, end: { line: 8 } },
  };
  assert.equal(
    frontmatterToSearchText(frontmatter),
    [
      'title A clipped article',
      'author Steve Yegge',
      'published 2026-08-05',
      'details publication Example Weekly',
    ].join('\n'),
  );

  const passages = chunkMarkdown({
    path: 'Clippings/Article.md',
    markdown: '---\nauthor:\n  - "[[Steve Yegge]]"\n---\nBody without the author.',
    chunkSize: 1200,
    chunkOverlap: 160,
    tags: ['#clippings'],
    frontmatter,
    mtime: 100,
    ctime: 50,
  });
  const properties = passages.find(({ heading }) => heading === 'Properties');
  assert.match(properties?.searchText ?? '', /author Steve Yegge/);
  assert.match(properties?.preview ?? '', /publication Example Weekly/);
  assert.doesNotMatch(properties?.searchText ?? '', /position/);

  const metadataOnly = chunkMarkdown({
    path: 'Clippings/Metadata only.md',
    markdown: '---\nauthor: "[[Steve Yegge]]"\n---',
    chunkSize: 1200,
    chunkOverlap: 160,
    tags: [],
    frontmatter: { author: '[[Steve Yegge]]' },
    mtime: 100,
    ctime: 50,
  });
  assert.equal(metadataOnly.length, 1);
  assert.equal(metadataOnly[0]?.heading, 'Properties');
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

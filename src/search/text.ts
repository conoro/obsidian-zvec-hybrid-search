import { createHash } from 'node:crypto';
import type { Passage } from '../types';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function stablePassageId(path: string, chunkIndex: number): string {
  return createHash('sha1').update(`${path}\0${chunkIndex}`).digest('hex');
}

export function noteTitle(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  return fileName.replace(/\.md$/i, '');
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(FRONTMATTER, '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, ' '))
    .replace(/!\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ChunkOptions {
  path: string;
  markdown: string;
  chunkSize: number;
  chunkOverlap: number;
  tags: string[];
  frontmatter?: Record<string, unknown>;
  mtime: number;
  ctime: number;
}

interface TextBlock {
  heading: string;
  text: string;
  line: number;
  startsSection: boolean;
}

function blocksFromMarkdown(markdown: string): TextBlock[] {
  const frontmatter = markdown.match(FRONTMATTER)?.[0] ?? '';
  const lineOffset = frontmatter
    ? frontmatter.split(/\r?\n/).length - 1
    : 0;
  const withoutFrontmatter = markdown.slice(frontmatter.length);
  const lines = withoutFrontmatter.split(/\r?\n/);
  const blocks: TextBlock[] = [];
  let heading = '';
  let blockLines: string[] = [];
  let blockStart = lineOffset;

  const flush = (): void => {
    const text = blockLines.join('\n').trim();
    if (text) {
      blocks.push({
        heading,
        text,
        line: blockStart,
        startsSection: false,
      });
    }
    blockLines = [];
  };

  lines.forEach((line, index) => {
    const match = line.match(HEADING);
    if (match) {
      flush();
      heading = markdownToPlainText(match[2] ?? '');
      blockStart = index + lineOffset;
      blocks.push({
        heading,
        text: heading,
        line: index + lineOffset,
        startsSection: true,
      });
      return;
    }
    if (!line.trim()) {
      flush();
      blockStart = index + lineOffset + 1;
      return;
    }
    if (blockLines.length === 0) blockStart = index + lineOffset;
    blockLines.push(line);
  });
  flush();
  return blocks;
}

export function chunkMarkdown(options: ChunkOptions): Passage[] {
  const title = noteTitle(options.path);
  const folder = options.path.includes('/')
    ? options.path.slice(0, options.path.lastIndexOf('/'))
    : '';
  const blocks = blocksFromMarkdown(options.markdown);
  const passages: Passage[] = [];
  let content = '';
  let heading = '';
  let startLine = 0;

  const emit = (): void => {
    const plain = markdownToPlainText(content);
    if (!plain) return;
    const chunkIndex = passages.length;
    const titleText = [title, heading, options.tags.join(' ')].filter(Boolean).join(' — ');
    passages.push({
      id: stablePassageId(options.path, chunkIndex),
      path: options.path,
      title,
      heading,
      content: plain,
      searchText: `${titleText}\n${plain}`,
      titleText,
      preview: plain.slice(0, 420),
      tags: options.tags,
      folder,
      startLine,
      chunkIndex,
      mtime: Math.trunc(options.mtime),
      ctime: Math.trunc(options.ctime),
    });
  };

  for (const block of blocks) {
    const plainBlock = markdownToPlainText(block.text);
    if (!plainBlock) continue;

    if (block.startsSection) {
      emit();
      content = block.text;
      heading = block.heading;
      startLine = block.line;
      continue;
    }

    if (!content) {
      content = block.text;
      heading = block.heading;
      startLine = block.line;
      continue;
    }

    if (content.length + block.text.length + 2 <= options.chunkSize) {
      content += `\n\n${block.text}`;
      if (!heading) heading = block.heading;
      continue;
    }

    emit();
    const overlap = markdownToPlainText(content).slice(-options.chunkOverlap);
    content = overlap ? `${overlap}\n\n${block.text}` : block.text;
    heading = block.heading;
    startLine = block.line;
  }

  emit();

  const metadataText = frontmatterToSearchText(options.frontmatter);
  if (metadataText) {
    const chunkIndex = passages.length;
    passages.push({
      id: stablePassageId(options.path, chunkIndex),
      path: options.path,
      title,
      heading: 'Properties',
      content: metadataText,
      searchText: `${title}\n${metadataText}`,
      titleText: `${title} — Properties`,
      preview: metadataText.slice(0, 420),
      tags: options.tags,
      folder,
      startLine: 0,
      chunkIndex,
      mtime: Math.trunc(options.mtime),
      ctime: Math.trunc(options.ctime),
    });
  }

  if (passages.length === 0) {
    const plain = markdownToPlainText(options.markdown);
    if (plain) {
      passages.push({
        id: stablePassageId(options.path, 0),
        path: options.path,
        title,
        heading: '',
        content: plain,
        searchText: `${title}\n${plain}`,
        titleText: title,
        preview: plain.slice(0, 420),
        tags: options.tags,
        folder,
        startLine: 0,
        chunkIndex: 0,
        mtime: Math.trunc(options.mtime),
        ctime: Math.trunc(options.ctime),
      });
    }
  }
  return passages;
}

export function frontmatterToSearchText(
  frontmatter: Record<string, unknown> | undefined,
  maximumLength = 12_000,
): string {
  if (!frontmatter || maximumLength <= 0) return '';
  const lines: string[] = [];
  let length = 0;

  const add = (path: string[], value: unknown): void => {
    const plain = markdownToPlainText(String(value)).slice(0, 2000);
    if (!plain) return;
    const line = `${path.join(' ')} ${plain}`.trim();
    const remaining = maximumLength - length;
    if (remaining <= 0) return;
    const bounded = line.slice(0, remaining);
    lines.push(bounded);
    length += bounded.length + 1;
  };

  const visit = (value: unknown, path: string[], depth: number): void => {
    if (length >= maximumLength || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      add(path, value);
      return;
    }
    if (depth >= 5) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) visit(item, path, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'position') continue;
        visit(nested, [...path, key], depth + 1);
      }
    }
  };

  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === 'position') continue;
    visit(value, [key], 0);
  }
  return lines.join('\n');
}

export function queryTerms(query: string): string[] {
  const matches = query.match(/"([^"]+)"|[^\s]+/g) ?? [];
  return matches
    .map((term) => term.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
}

export function escapeFtsPhrase(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function escapeFilterString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function matchesGlob(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`, 'i').test(path);
}

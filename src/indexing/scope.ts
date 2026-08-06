import { matchesGlob } from '../search/text';
import type { HybridSearchSettings } from '../types';
import { ROOT_FOLDER } from '../types';

export function shouldIndex(
  file: { path: string },
  settings: Pick<HybridSearchSettings, 'indexedFolders' | 'excludePatterns'>,
  configDir?: string,
): boolean {
  if (!file.path.toLocaleLowerCase().endsWith('.md')) return false;
  if (file.path.split('/').some((segment) => segment.startsWith('.'))) return false;
  const normalizedConfigDir = configDir
    ?.replaceAll('\\', '/')
    .replace(/^\/+|\/+$/gu, '');
  if (
    normalizedConfigDir
    && (
      file.path === normalizedConfigDir
      || file.path.startsWith(`${normalizedConfigDir}/`)
    )
  ) {
    return false;
  }
  if (settings.excludePatterns.some((pattern) => matchesGlob(file.path, pattern))) {
    return false;
  }
  if (settings.indexedFolders.includes(ROOT_FOLDER)) return true;
  const topLevel = file.path.includes('/')
    ? file.path.split('/')[0] ?? ''
    : ROOT_FOLDER;
  return settings.indexedFolders.includes(topLevel);
}

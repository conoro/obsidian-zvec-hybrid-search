import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const STORAGE_MARKER = '.storage-ready.json';

interface LocalDataPathOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}

export function localDataDirectory(
  vaultPath: string,
  options: LocalDataPathOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;
  const vaultKey = createHash('sha256')
    .update(vaultPath)
    .digest('hex')
    .slice(0, 20);
  const applicationData = platform === 'darwin'
    ? join(homeDirectory, 'Library', 'Application Support')
    : platform === 'win32'
      ? (
        environment.LOCALAPPDATA
        ?? environment.APPDATA
        ?? join(homeDirectory, 'AppData', 'Local')
      )
      : (
        environment.XDG_DATA_HOME
        ?? join(homeDirectory, '.local', 'share')
      );
  return join(
    applicationData,
    'zvec-hybrid-search',
    'vaults',
    vaultKey,
  );
}

export async function prepareLocalDataDirectory(
  targetDirectory: string,
  legacyDataDirectory: string,
): Promise<{ directory: string; migrated: boolean }> {
  const marker = join(targetDirectory, STORAGE_MARKER);
  if (await pathExists(marker)) {
    return { directory: targetDirectory, migrated: false };
  }
  if (await pathExists(targetDirectory)) {
    throw new Error(
      `Local ZVec data exists without a completed migration marker: ${targetDirectory}`,
    );
  }

  await fs.mkdir(dirname(targetDirectory), { recursive: true });
  const stagingDirectory = `${targetDirectory}.migrating-${process.pid}-${Date.now()}`;
  const hasLegacyData = await pathExists(legacyDataDirectory);
  try {
    if (hasLegacyData) {
      await fs.cp(legacyDataDirectory, stagingDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } else {
      await fs.mkdir(stagingDirectory, { recursive: true });
    }
    await fs.writeFile(
      join(stagingDirectory, STORAGE_MARKER),
      `${JSON.stringify({
        schemaVersion: 1,
        migratedLegacyData: hasLegacyData,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.rename(stagingDirectory, targetDirectory);
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
  return {
    directory: targetDirectory,
    migrated: hasLegacyData,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

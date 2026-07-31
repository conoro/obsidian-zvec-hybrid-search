#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  installNodeExecutable,
  pruneUnusedPlatformPayloads,
  runtimePackageJson,
  runtimePlatformKey,
  writeNodeLicense,
  writeReadyMarker,
} from './runtime-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const pluginId = 'zvec-hybrid-search';
const args = process.argv.slice(2);
const vaultFlagIndex = args.indexOf('--vault');
const vault = vaultFlagIndex >= 0
  ? args[vaultFlagIndex + 1]
  : process.env.OBSIDIAN_VAULT;

if (!vault) {
  console.error(
    'Supply an Obsidian vault with --vault "/path/to/Vault" or OBSIDIAN_VAULT.',
  );
  process.exit(1);
}

if (!existsSync(join(vault, '.obsidian'))) {
  console.error(`Vault not found or missing .obsidian: ${vault ?? '(not supplied)'}`);
  process.exit(1);
}

const target = join(vault, '.obsidian', 'plugins', pluginId);
mkdirSync(target, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  const source = join(projectRoot, file);
  if (!existsSync(source)) {
    console.error(`Missing ${file}. Run npm run build first.`);
    process.exit(1);
  }
  copyFileSync(source, join(target, file));
}

const projectPackage = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const platformKey = runtimePlatformKey();
const legacyDataTarget = join(target, 'search-data');
const vaultKey = createHash('sha256').update(vault).digest('hex').slice(0, 20);
const applicationData = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support')
  : process.platform === 'win32'
    ? (
      process.env.LOCALAPPDATA
      ?? process.env.APPDATA
      ?? join(homedir(), 'AppData', 'Local')
    )
    : (
      process.env.XDG_DATA_HOME
      ?? join(homedir(), '.local', 'share')
    );
const dataTarget = join(
  applicationData,
  'zvec-hybrid-search',
  'vaults',
  vaultKey,
);
if (!existsSync(dataTarget)) {
  mkdirSync(dirname(dataTarget), { recursive: true });
  const stagingTarget = `${dataTarget}.migrating-${process.pid}-${Date.now()}`;
  try {
    if (existsSync(legacyDataTarget)) {
      cpSync(legacyDataTarget, stagingTarget, { recursive: true });
    } else {
      mkdirSync(stagingTarget, { recursive: true });
    }
    writeFileSync(
      join(stagingTarget, '.storage-ready.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        migratedLegacyData: existsSync(legacyDataTarget),
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
      'utf8',
    );
    renameSync(stagingTarget, dataTarget);
  } catch (error) {
    rmSync(stagingTarget, { recursive: true, force: true });
    throw error;
  }
}
const runtimeTarget = join(
  dataTarget,
  'runtime',
  projectPackage.version,
  platformKey,
);
rmSync(runtimeTarget, { recursive: true, force: true });
mkdirSync(runtimeTarget, { recursive: true });
const runtimePackage = runtimePackageJson(projectPackage);
writeFileSync(
  join(runtimeTarget, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
  'utf8',
);

console.log('Installing native ZVec and local embedding runtime...');
const install = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund'],
  {
    cwd: runtimeTarget,
    shell: process.platform === 'win32',
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

pruneUnusedPlatformPayloads(
  join(runtimeTarget, 'node_modules'),
  process.platform,
  process.arch,
);
installNodeExecutable(runtimeTarget, platformKey);
await writeNodeLicense(runtimeTarget);
writeReadyMarker(
  runtimeTarget,
  projectPackage.version,
  platformKey,
);
rmSync(join(target, 'node_modules'), { recursive: true, force: true });
rmSync(join(target, 'package.json'), { force: true });
rmSync(join(target, 'package-lock.json'), { force: true });

console.log(`Installed ZVec Hybrid Search to ${target}`);
console.log(`Installed generated search data to ${dataTarget}`);
console.log('The private Node runtime is included; no system Node is used by Obsidian.');
console.log('Enable or reload it in Obsidian → Settings → Community plugins.');

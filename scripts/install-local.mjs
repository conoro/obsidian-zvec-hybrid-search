#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const runtimeTarget = join(
  target,
  'search-data',
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
console.log('The private Node runtime is included; no system Node is used by Obsidian.');
console.log('Enable or reload it in Obsidian → Settings → Community plugins.');

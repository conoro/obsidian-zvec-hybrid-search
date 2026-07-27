#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const runtimePackage = {
  name: `${pluginId}-runtime`,
  private: true,
  dependencies: projectPackage.dependencies,
  overrides: projectPackage.overrides,
};
writeFileSync(
  join(target, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
  'utf8',
);

console.log('Installing native ZVec and local embedding runtime...');
const install = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund'],
  { cwd: target, stdio: 'inherit' },
);
if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

pruneUnusedPlatformPayloads(join(target, 'node_modules'));

console.log(`Installed ZVec Hybrid Search to ${target}`);
console.log('Enable or reload it in Obsidian → Settings → Community plugins.');

function pruneUnusedPlatformPayloads(nodeModules) {
  // Transformers.js installs every ONNX platform plus the browser runtime.
  // Obsidian uses Node's native backend, so keep only this machine's binary.
  rmSync(join(nodeModules, 'onnxruntime-web'), { recursive: true, force: true });

  const onnxPlatforms = join(nodeModules, 'onnxruntime-node', 'bin', 'napi-v6');
  if (existsSync(onnxPlatforms)) {
    for (const platform of readdirSync(onnxPlatforms)) {
      const platformPath = join(onnxPlatforms, platform);
      if (platform !== process.platform) {
        rmSync(platformPath, { recursive: true, force: true });
        continue;
      }
      for (const architecture of readdirSync(platformPath)) {
        if (architecture !== process.arch) {
          rmSync(join(platformPath, architecture), {
            recursive: true,
            force: true,
          });
        }
      }
    }
  }

  const imagePackages = join(nodeModules, '@img');
  if (existsSync(imagePackages)) {
    for (const packageName of readdirSync(imagePackages)) {
      if (
        packageName !== 'colour'
        && !packageName.endsWith(`${process.platform}-${process.arch}`)
      ) {
        rmSync(join(imagePackages, packageName), {
          recursive: true,
          force: true,
        });
      }
    }
  }
}

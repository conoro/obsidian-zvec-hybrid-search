#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNTIME_SCRIPT_PATHS = [
  'scripts/package-runtime.mjs',
  'scripts/runtime-utils.mjs',
];

export function runtimeInputsChanged(baseRevision, headRevision) {
  if (!baseRevision || /^0+$/u.test(baseRevision) || !headRevision) {
    return true;
  }
  try {
    const changedScripts = git([
      'diff',
      '--name-only',
      baseRevision,
      headRevision,
      '--',
      ...RUNTIME_SCRIPT_PATHS,
    ]).trim();
    if (changedScripts) return true;

    const basePackage = runtimePackageConfig(
      readJsonAt(baseRevision, 'package.json'),
    );
    const headPackage = runtimePackageConfig(
      readJsonAt(headRevision, 'package.json'),
    );
    if (!sameJson(basePackage, headPackage)) return true;

    const baseLock = runtimeLockConfig(
      readJsonAt(baseRevision, 'package-lock.json'),
    );
    const headLock = runtimeLockConfig(
      readJsonAt(headRevision, 'package-lock.json'),
    );
    return !sameJson(baseLock, headLock);
  } catch (error) {
    console.error(
      `Could not compare runtime inputs; rebuilding them defensively: ${errorMessage(error)}`,
    );
    return true;
  }
}

export function runtimePackageConfig(projectPackage) {
  return {
    runtimeReleaseVersion: projectPackage.runtimeReleaseVersion,
    dependencies: projectPackage.dependencies,
    overrides: projectPackage.overrides,
  };
}

export function runtimeLockConfig(lock) {
  const packages = {};
  for (const [path, value] of Object.entries(lock.packages ?? {})) {
    if (path !== '' && value.dev === true) continue;
    const entry = structuredClone(value);
    if (path === '') {
      delete entry.name;
      delete entry.version;
      delete entry.devDependencies;
      delete entry.engines;
      delete entry.scripts;
    }
    packages[path] = entry;
  }
  return {
    lockfileVersion: lock.lockfileVersion,
    packages,
  };
}

function readJsonAt(revision, path) {
  return JSON.parse(git(['show', `${revision}:${path}`]));
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changed = runtimeInputsChanged(process.argv[2], process.argv[3]);
  process.stdout.write(`rebuild=${changed}\n`);
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import {
  assertRuntimeHasNoSymlinks,
  installNodeExecutable,
  pruneUnusedPlatformPayloads,
  runtimePackageJson,
  runtimePlatformKey,
  writeNodeLicense,
} from './runtime-utils.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const projectPackage = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);
const args = process.argv.slice(2);
const target = readFlag('--target') ?? runtimePlatformKey();
const outputDirectory = resolve(
  readFlag('--output') ?? join(projectRoot, 'dist', 'runtime'),
);
const platformKey = runtimePlatformKey();
if (target !== platformKey) {
  throw new Error(
    `Runtime archives must be built natively. Requested ${target}, running on ${platformKey}.`,
  );
}
if (!process.version.startsWith('v22.')) {
  throw new Error(`Release runtimes require Node 22; found ${process.version}.`);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'zvec-runtime-package-'));
const payload = join(temporaryRoot, 'payload');
const assetName =
  `zvec-runtime-${projectPackage.version}-${platformKey}.zip`;
const assetPath = join(outputDirectory, assetName);

try {
  mkdirSync(payload, { recursive: true });
  copyFileSync(join(projectRoot, 'package.json'), join(payload, 'package.json'));
  copyFileSync(
    join(projectRoot, 'package-lock.json'),
    join(payload, 'package-lock.json'),
  );
  run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--omit=dev', '--no-audit', '--no-fund'],
    payload,
  );
  writeFileSync(
    join(payload, 'package.json'),
    `${JSON.stringify(runtimePackageJson(projectPackage), null, 2)}\n`,
    'utf8',
  );
  rmSync(join(payload, 'package-lock.json'), { force: true });
  pruneUnusedPlatformPayloads(
    join(payload, 'node_modules'),
    process.platform,
    process.arch,
  );
  const nodeExecutable = installNodeExecutable(payload, platformKey);
  await writeNodeLicense(payload);
  writeFileSync(
    join(payload, 'runtime.json'),
    `${JSON.stringify({
      formatVersion: 1,
      pluginVersion: projectPackage.version,
      platformKey,
      nodeVersion: process.version,
    }, null, 2)}\n`,
    'utf8',
  );
  assertRuntimeHasNoSymlinks(payload);
  smokeTest(nodeExecutable, payload);

  mkdirSync(outputDirectory, { recursive: true });
  rmSync(assetPath, { force: true });
  await createArchive(payload, assetPath);
  const digest = await sha256(assetPath);
  writeFileSync(`${assetPath}.sha256`, `${digest}  ${assetName}\n`, 'utf8');
  const megabytes = (statSync(assetPath).size / 1024 / 1024).toFixed(1);
  console.log(`Created ${assetPath} (${megabytes} MiB)`);
  console.log(`SHA-256 ${digest}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function readFlag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    shell: process.platform === 'win32'
      && command.toLowerCase().endsWith('.cmd'),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${result.status ?? 'unknown'}`
      + `${result.error ? `: ${result.error.message}` : '.'}`,
    );
  }
}

function smokeTest(nodeExecutable, runtimeDirectory) {
  const source = `
    const { createRequire } = require('node:module');
    const { join } = require('node:path');
    const load = createRequire(join(process.cwd(), 'main.js'));
    const zvec = load('@zvec/zvec');
    const onnx = load('onnxruntime-node');
    if (typeof zvec.ZVecCreateAndOpen !== 'function') {
      throw new Error('ZVec native binding did not load.');
    }
    if (typeof onnx.InferenceSession?.create !== 'function') {
      throw new Error('ONNX Runtime native binding did not load.');
    }
    console.log('Native runtime smoke test passed.');
  `;
  run(nodeExecutable, ['-e', source], runtimeDirectory);
}

function createArchive(source, destination) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(destination, {
      flags: 'wx',
      mode: 0o644,
    });
    const archive = new ZipArchive({
      zlib: { level: 9 },
    });
    output.once('close', resolvePromise);
    output.once('error', reject);
    archive.once('warning', reject);
    archive.once('error', reject);
    archive.pipe(output);
    archive.directory(source, false);
    void archive.finalize();
  });
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

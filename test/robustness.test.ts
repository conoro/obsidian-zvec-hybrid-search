import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ZipArchive } from 'archiver';
import { WorkerRpcClient } from '../src/runtime/worker-rpc';
import {
  PluginRuntimeError,
  withTimeout,
} from '../src/runtime/safety';
import {
  RuntimeManager,
  extractZipSafely,
  isExpectedRuntimeAssetUrl,
  runtimeAssetName,
  runtimeNodeRelativePath,
  runtimePlatformKey,
  safeZipEntryPath,
} from '../src/runtime/runtime-manager';
import {
  localDataDirectory,
  prepareLocalDataDirectory,
} from '../src/runtime/data-directory';
import { initializeThenPublish } from '../src/runtime/initialization';
import {
  normalizeSettings,
  parseTopLevelFolders,
} from '../src/settings';
import {
  hashEmbedding,
  LocalEmbeddingService,
} from '../src/search/embeddings';
import { ZVecStore } from '../src/search/zvec-store';
import { createZVecWorkerSource } from '../src/search/zvec-worker';
import { DEFAULT_SETTINGS } from '../src/types';

test('settings normalization bounds malformed persisted values', () => {
  const settings = normalizeSettings({
    indexedFolders: ['Notes', 'Notes', 7, ''],
    excludePatterns: 'not-an-array',
    autoIndex: 'yes',
    chunkSize: Number.POSITIVE_INFINITY,
    chunkOverlap: -500,
    embeddingBackend: 'remote',
    embeddingModel: ' '.repeat(20),
    embeddingDtype: 'unsafe',
    embeddingBatchSize: 100_000,
    defaultMode: 'invalid',
    defaultMatchMode: 'invalid',
    defaultSort: 'invalid',
    defaultGrouping: 'invalid',
    resultLimit: 100_000,
    candidateLimit: 100_000,
    titleBoost: Number.NaN,
  });

  assert.deepEqual(settings.indexedFolders, ['Notes']);
  assert.deepEqual(settings.excludePatterns, DEFAULT_SETTINGS.excludePatterns);
  assert.equal(settings.autoIndex, DEFAULT_SETTINGS.autoIndex);
  assert.equal(settings.chunkSize, DEFAULT_SETTINGS.chunkSize);
  assert.equal(settings.chunkOverlap, 0);
  assert.equal(settings.embeddingBackend, DEFAULT_SETTINGS.embeddingBackend);
  assert.equal(settings.embeddingModel, DEFAULT_SETTINGS.embeddingModel);
  assert.equal(settings.embeddingDtype, DEFAULT_SETTINGS.embeddingDtype);
  assert.equal(settings.embeddingBatchSize, 64);
  assert.equal(settings.defaultMode, DEFAULT_SETTINGS.defaultMode);
  assert.equal(settings.resultLimit, 100);
  assert.equal(settings.candidateLimit, 2000);
  assert.equal(settings.titleBoost, DEFAULT_SETTINGS.titleBoost);
});

test('included folder input stays vault-relative and release-generic', () => {
  assert.deepEqual(
    parseTopLevelFolders('Projects\n/Archive/\nProjects\nNested/Child\n.hidden'),
    ['Archive', 'Nested', 'Projects'],
  );
  assert.deepEqual(parseTopLevelFolders(' \n/\n.\n'), []);
});

test('timeout wrapper rejects stalled async work without blocking the event loop', async () => {
  let timerFired = false;
  setTimeout(() => {
    timerFired = true;
  }, 5);
  await assert.rejects(
    withTimeout(new Promise<never>(() => undefined), 25, 'Test operation'),
    (error: unknown) =>
      error instanceof PluginRuntimeError
      && error.code === 'OPERATION_TIMEOUT',
  );
  assert.equal(timerFired, true);
});

test('runtime platform selection covers every published desktop target', () => {
  assert.equal(runtimePlatformKey('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(runtimePlatformKey('win32', 'x64'), 'win32-x64');
  assert.equal(runtimePlatformKey('linux', 'x64'), 'linux-x64');
  assert.equal(runtimePlatformKey('linux', 'arm64'), 'linux-arm64');
  assert.throws(
    () => runtimePlatformKey('darwin', 'x64'),
    (error: unknown) =>
      error instanceof PluginRuntimeError
      && error.code === 'RUNTIME_UNAVAILABLE',
  );
  assert.equal(
    runtimeAssetName('0.2.0', 'linux-arm64'),
    'zvec-runtime-0.2.0-linux-arm64.zip',
  );
});

test('generated search data uses an opaque machine-local directory', () => {
  const vaultPath = '/Volumes/External/Dropbox/Obsidian';
  const macPath = localDataDirectory(vaultPath, {
    platform: 'darwin',
    homeDirectory: '/Users/example',
    environment: {},
  });
  const windowsPath = localDataDirectory(vaultPath, {
    platform: 'win32',
    homeDirectory: 'C:\\Users\\example',
    environment: { LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' },
  });
  const linuxPath = localDataDirectory(vaultPath, {
    platform: 'linux',
    homeDirectory: '/home/example',
    environment: { XDG_DATA_HOME: '/home/example/.local/share' },
  });

  assert.match(
    macPath,
    /^\/Users\/example\/Library\/Application Support\/zvec-hybrid-search\/vaults\/[a-f0-9]{20}$/u,
  );
  assert.match(windowsPath, /zvec-hybrid-search[\\/]vaults[\\/][a-f0-9]{20}$/u);
  assert.match(linuxPath, /zvec-hybrid-search\/vaults\/[a-f0-9]{20}$/u);
  for (const path of [macPath, windowsPath, linuxPath]) {
    assert.equal(path.includes('Dropbox'), false);
    assert.equal(path.includes('Obsidian'), false);
  }
});

test('legacy generated data is copied once into local storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-data-migration-'));
  const legacy = join(directory, 'legacy');
  const target = join(directory, 'local', 'vault-key');
  try {
    await mkdir(join(legacy, 'collection'), { recursive: true });
    await writeFile(join(legacy, 'index-state.json'), '{"files":{}}');
    await writeFile(join(legacy, 'collection', 'manifest.0'), 'collection');

    const first = await prepareLocalDataDirectory(target, legacy);
    assert.equal(first.migrated, true);
    assert.equal(
      await readFile(join(target, 'collection', 'manifest.0'), 'utf8'),
      'collection',
    );

    await writeFile(join(legacy, 'index-state.json'), 'changed legacy data');
    const second = await prepareLocalDataDirectory(target, legacy);
    assert.equal(second.migrated, false);
    assert.equal(
      await readFile(join(target, 'index-state.json'), 'utf8'),
      '{"files":{}}',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime components remain private until initialization completes', async () => {
  let finishInitialization: (() => void) | undefined;
  let published = false;
  const initialization = new Promise<void>((resolve) => {
    finishInitialization = resolve;
  });
  const startup = initializeThenPublish(
    () => initialization,
    () => {
      published = true;
    },
  );

  await Promise.resolve();
  assert.equal(published, false);
  finishInitialization?.();
  await startup;
  assert.equal(published, true);
});

test('runtime downloads accept only the old and new repository paths', () => {
  const version = '0.2.6';
  const assetName = runtimeAssetName(version, 'darwin-arm64');
  for (const repository of [
    'conoro/zvec-hybrid-search',
    'conoro/obsidian-zvec-hybrid-search',
  ]) {
    assert.equal(
      isExpectedRuntimeAssetUrl(
        new URL(
          `https://github.com/${repository}/releases/download/${version}/${assetName}`,
        ),
        version,
        assetName,
      ),
      true,
    );
  }
  for (const url of [
    `https://github.com/another-owner/obsidian-zvec-hybrid-search/releases/download/${version}/${assetName}`,
    `https://github.com/conoro/another-repository/releases/download/${version}/${assetName}`,
    `https://github.com/conoro/obsidian-zvec-hybrid-search/releases/download/0.2.5/${assetName}`,
    `https://github.com/conoro/obsidian-zvec-hybrid-search/releases/download/${version}/different.zip`,
  ]) {
    assert.equal(
      isExpectedRuntimeAssetUrl(new URL(url), version, assetName),
      false,
    );
  }
});

test('runtime archive paths reject traversal and absolute locations', () => {
  assert.equal(safeZipEntryPath('node_modules/pkg/index.js'), 'node_modules/pkg/index.js');
  assert.equal(safeZipEntryPath('bin\\node.exe'), 'bin/node.exe');
  for (const path of [
    '../outside',
    'node_modules/../outside',
    '/absolute/path',
    'C:\\absolute\\path',
    'bad\0name',
  ]) {
    assert.throws(() => safeZipEntryPath(path), /Unsafe runtime archive entry/u);
  }
});

test('runtime archives extract through the bounded streaming installer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-runtime-extract-'));
  const archivePath = join(directory, 'runtime.zip');
  const extracted = join(directory, 'extracted');
  try {
    await createTestZip(archivePath);
    await mkdir(extracted, { recursive: true });
    await extractZipSafely(
      archivePath,
      extracted,
      new AbortController().signal,
    );
    assert.equal(
      await readFile(join(extracted, 'bin', 'node'), 'utf8'),
      'private runtime',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a validated local private runtime is reused without network access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-runtime-manager-'));
  const version = 'test-version';
  const platformKey = runtimePlatformKey();
  const runtimeRoot = join(
    directory,
    'runtime',
    version,
    platformKey,
  );
  const nodePath = join(
    runtimeRoot,
    ...runtimeNodeRelativePath(platformKey).split('/'),
  );
  try {
    await mkdir(dirname(nodePath), { recursive: true });
    await mkdir(
      join(runtimeRoot, 'node_modules', '@zvec', 'zvec'),
      { recursive: true },
    );
    await mkdir(
      join(runtimeRoot, 'node_modules', '@huggingface', 'transformers'),
      { recursive: true },
    );
    await copyFile(process.execPath, nodePath);
    await writeFile(join(runtimeRoot, 'package.json'), '{}');
    await writeFile(
      join(runtimeRoot, 'node_modules', '@zvec', 'zvec', 'package.json'),
      '{}',
    );
    await writeFile(
      join(
        runtimeRoot,
        'node_modules',
        '@huggingface',
        'transformers',
        'package.json',
      ),
      '{}',
    );
    await writeFile(
      join(runtimeRoot, '.ready.json'),
      JSON.stringify({
        version,
        platformKey,
        source: 'local-development',
      }),
    );
    const manager = new RuntimeManager(directory, version, () => undefined);
    const runtime = await manager.ensure();
    assert.equal(runtime.rootDirectory, runtimeRoot);
    assert.equal(runtime.nodeExecutable, nodePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a hung native-style worker is terminated while the main loop stays responsive', async () => {
  let failureCount = 0;
  const client = new WorkerRpcClient(
    `
      const { parentPort } = require('node:worker_threads');
      parentPort.on('message', () => { while (true) {} });
    `,
    {},
    () => {
      failureCount += 1;
    },
  );
  let mainLoopTimerFired = false;
  setTimeout(() => {
    mainLoopTimerFired = true;
  }, 10);

  await assert.rejects(
    client.request('blocked-operation', {}, 40),
    (error: unknown) =>
      error instanceof PluginRuntimeError
      && error.code === 'OPERATION_TIMEOUT',
  );
  assert.equal(mainLoopTimerFired, true);
  assert.equal(failureCount, 1);
  await client.stop();
});

test('Electron-style child-process isolation supports request and shutdown', async () => {
  const client = new WorkerRpcClient(
    `
      process.on('message', (request) => {
        process.send({
          id: request.id,
          ok: true,
          result: { echoed: request.args.value },
        });
      });
    `,
    {},
    () => undefined,
    undefined,
    true,
  );
  try {
    const result = await client.request<{ echoed: string }>(
      'echo',
      { value: 'isolated child' },
      1000,
    );
    assert.deepEqual(result, { echoed: 'isolated child' });
  } finally {
    await client.stop();
  }
});

test('native stderr is retained when a worker returns an empty error', async () => {
  const client = new WorkerRpcClient(
    `
      process.on('message', (request) => {
        process.stderr.write('native reducer detail\\n');
        setTimeout(() => process.send({
          id: request.id,
          ok: false,
          error: { message: '' },
        }), 20);
      });
    `,
    {},
    () => undefined,
    undefined,
    true,
  );
  try {
    await assert.rejects(
      client.request('optimize', {}, 1000),
      (error: unknown) =>
        error instanceof PluginRuntimeError
        && error.message.includes('native reducer detail'),
    );
  } finally {
    await client.stop();
  }
});

test('ZVec opens and closes through Electron-style child isolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-child-store-'));
  const client = new WorkerRpcClient(
    createZVecWorkerSource(),
    {
      collectionPath: join(directory, 'collection'),
      runtimeDirectory: process.cwd(),
      embeddingDimension: 384,
    },
    () => undefined,
    undefined,
    true,
  );
  try {
    const opened = await client.request<{
      stats: { docCount: number };
    }>('open', {}, 5000);
    assert.equal(opened.stats.docCount, 0);
    await client.request('close', {}, 1000);
  } finally {
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('unavailable collection storage fails locally instead of blocking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-unavailable-store-'));
  const blocker = join(directory, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  const store = new ZVecStore(join(blocker, 'collection'));
  try {
    const started = performance.now();
    await assert.rejects(
      store.open(true),
      (error: unknown) =>
        error instanceof PluginRuntimeError
        && error.code === 'RUNTIME_UNAVAILABLE',
    );
    assert.ok(performance.now() - started < 5000);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('an existing invalid collection is never replaced after an open failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-existing-collection-'));
  const collection = join(directory, 'collection');
  const sentinel = join(collection, 'do-not-replace.txt');
  await mkdir(collection);
  await writeFile(sentinel, 'existing collection');
  const store = new ZVecStore(collection);
  try {
    await assert.rejects(
      store.open(true),
      (error: unknown) =>
        error instanceof PluginRuntimeError
        && error.code === 'RUNTIME_UNAVAILABLE'
        && error.message.includes('left untouched'),
    );
    assert.equal(await readFile(sentinel, 'utf8'), 'existing collection');
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('hash embeddings run in an isolated worker and dispose cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-embedding-worker-'));
  const service = new LocalEmbeddingService(
    directory,
    'hash',
    'unused',
    'q4',
    () => undefined,
  );
  try {
    const [actual] = await service.embed(['isolated embedding']);
    assert.deepEqual(actual, hashEmbedding('isolated embedding'));
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('idle embedding workers stop and restart on demand', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zvec-idle-worker-'));
  const service = new LocalEmbeddingService(
    directory,
    'hash',
    'unused',
    'q4',
    () => undefined,
    process.cwd(),
    10,
  );
  try {
    const [first] = await service.embed(['sleeping embedding worker']);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(
      (service as unknown as { client: unknown }).client,
      null,
    );
    const [second] = await service.embed(['sleeping embedding worker']);
    assert.deepEqual(second, first);
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function createTestZip(destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
    archive.pipe(output);
    archive.append('private runtime', {
      name: 'bin/node',
      mode: 0o755,
    });
    void archive.finalize();
  });
}

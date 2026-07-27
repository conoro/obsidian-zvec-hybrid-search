import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkerRpcClient } from '../src/runtime/worker-rpc';
import {
  PluginRuntimeError,
  withTimeout,
} from '../src/runtime/safety';
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

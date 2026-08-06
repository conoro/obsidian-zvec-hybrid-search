import { createHash, randomUUID } from 'node:crypto';
import {
  createWriteStream,
  type ReadStream,
} from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { dirname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import {
  errorMessage,
  PluginRuntimeError,
} from './safety';

const RELEASE_REPOSITORIES = [
  'conoro/obsidian-zvec-hybrid-search',
  'conoro/zvec-hybrid-search',
] as const;
const RELEASE_API =
  `https://api.github.com/repos/${RELEASE_REPOSITORIES[0]}/releases/tags/`;
const MAX_RELEASE_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1_500 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const MAX_REDIRECTS = 5;
const RETRY_COOLDOWN_MS = 60_000;
const READY_FILE = '.ready.json';
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

export interface RuntimeInstallation {
  rootDirectory: string;
  nodeExecutable: string;
  platformKey: RuntimePlatformKey;
}

export type RuntimePlatformKey =
  | 'darwin-arm64'
  | 'win32-x64'
  | 'linux-x64'
  | 'linux-arm64';

interface ReleaseAsset {
  name?: unknown;
  size?: unknown;
  state?: unknown;
  digest?: unknown;
  browser_download_url?: unknown;
}

interface ReleaseMetadata {
  tag_name?: unknown;
  assets?: unknown;
}

interface RuntimeReadyMarker {
  version: string;
  platformKey: RuntimePlatformKey;
  source: 'github-release' | 'local-development';
  assetName?: string;
  sha256?: string;
}

interface ResolvedAsset {
  name: string;
  size: number;
  sha256: string;
  url: URL;
}

type StatusCallback = (message: string, completed?: number, total?: number) => void;

export class RuntimeManager {
  private abortController: AbortController | null = null;
  private installPromise: Promise<RuntimeInstallation> | null = null;
  private retryAfter = 0;
  private lastError: Error | null = null;

  constructor(
    private readonly dataDirectory: string,
    private readonly version: string,
    private readonly onStatus: StatusCallback,
  ) {}

  ensure(): Promise<RuntimeInstallation> {
    if (this.installPromise) return this.installPromise;
    if (Date.now() < this.retryAfter && this.lastError) {
      return Promise.reject(new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        `Runtime setup is cooling down after a failed attempt. Retry in ${Math.max(
          1,
          Math.ceil((this.retryAfter - Date.now()) / 1000),
        )} seconds. ${this.lastError.message}`,
        { cause: this.lastError, retryable: true },
      ));
    }
    const controller = new AbortController();
    this.abortController = controller;
    this.installPromise = this.install(controller.signal)
      .then((runtime) => {
        this.retryAfter = 0;
        this.lastError = null;
        return runtime;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          this.lastError = error instanceof Error ? error : new Error(String(error));
          this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
        }
        throw error;
      })
      .finally(() => {
        if (this.abortController === controller) this.abortController = null;
        this.installPromise = null;
      });
    return this.installPromise;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  private async install(signal: AbortSignal): Promise<RuntimeInstallation> {
    const platformKey = runtimePlatformKey();
    const runtimeRoot = join(
      this.dataDirectory,
      'runtime',
      this.version,
      platformKey,
    );
    const existing = await validateRuntimeInstallation(
      runtimeRoot,
      this.version,
      platformKey,
    );
    if (existing) return existing;

    this.onStatus('Preparing the private search runtime…');
    await mkdir(dirname(runtimeRoot), { recursive: true });
    throwIfAborted(signal);

    try {
      const asset = await this.resolveReleaseAsset(platformKey, signal);
      const workRoot = join(
        this.dataDirectory,
        'runtime',
        `.install-${randomUUID()}`,
      );
      const archivePath = `${workRoot}.zip`;
      try {
        await mkdir(workRoot, { recursive: true });
        this.onStatus(`Downloading ${humanPlatformName(platformKey)} runtime…`, 0, asset.size);
        const actualDigest = await downloadToFile(
          asset.url,
          archivePath,
          asset.size,
          signal,
          (completed) => this.onStatus(
            `Downloading ${humanPlatformName(platformKey)} runtime…`,
            completed,
            asset.size,
          ),
        );
        if (actualDigest !== asset.sha256) {
          throw new Error(
            `Runtime checksum mismatch (expected ${asset.sha256}, received ${actualDigest}).`,
          );
        }
        throwIfAborted(signal);
        this.onStatus('Verifying and installing the search runtime…');
        await extractZipSafely(archivePath, workRoot, signal);
        await validateRuntimePayload(workRoot, platformKey);
        const marker: RuntimeReadyMarker = {
          version: this.version,
          platformKey,
          source: 'github-release',
          assetName: asset.name,
          sha256: asset.sha256,
        };
        await writeFile(
          join(workRoot, READY_FILE),
          `${JSON.stringify(marker, null, 2)}\n`,
          'utf8',
        );
        await rm(runtimeRoot, { recursive: true, force: true });
        await rename(workRoot, runtimeRoot);
      } finally {
        await rm(archivePath, { force: true }).catch(() => undefined);
        await rm(workRoot, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    } catch (error) {
      if (signal.aborted) {
        throw new PluginRuntimeError(
          'PLUGIN_STOPPED',
          'Search runtime installation was cancelled.',
        );
      }
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        `The private search runtime could not be installed. Check the network connection and retry. ${errorMessage(error)}`,
        { cause: error, retryable: true },
      );
    }

    const installed = await validateRuntimeInstallation(
      runtimeRoot,
      this.version,
      platformKey,
    );
    if (!installed) {
      throw new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        'The private search runtime did not pass its post-install validation.',
        { retryable: true },
      );
    }
    return installed;
  }

  private async resolveReleaseAsset(
    platformKey: RuntimePlatformKey,
    signal: AbortSignal,
  ): Promise<ResolvedAsset> {
    const metadataUrl = new URL(
      `${RELEASE_API}${encodeURIComponent(this.version)}`,
    );
    const metadata = await getJson<ReleaseMetadata>(
      metadataUrl,
      signal,
      MAX_RELEASE_METADATA_BYTES,
    );
    if (metadata.tag_name !== this.version || !Array.isArray(metadata.assets)) {
      throw new Error(`Release ${this.version} is unavailable or malformed.`);
    }
    const expectedName = runtimeAssetName(this.version, platformKey);
    const asset = metadata.assets.find(
      (candidate): candidate is ReleaseAsset =>
        isRecord(candidate) && candidate.name === expectedName,
    );
    if (!asset) {
      throw new Error(`Release asset ${expectedName} was not found.`);
    }
    if (
      asset.state !== 'uploaded'
      || typeof asset.size !== 'number'
      || asset.size <= 0
      || asset.size > MAX_ARCHIVE_BYTES
      || typeof asset.digest !== 'string'
      || !/^sha256:[a-f0-9]{64}$/u.test(asset.digest)
      || typeof asset.browser_download_url !== 'string'
    ) {
      throw new Error(`Release asset ${expectedName} failed validation.`);
    }
    const url = new URL(asset.browser_download_url);
    assertAllowedUrl(url);
    if (!isExpectedRuntimeAssetUrl(url, this.version, expectedName)) {
      throw new Error(`Release asset ${expectedName} has an unexpected URL.`);
    }
    return {
      name: expectedName,
      size: asset.size,
      sha256: asset.digest.slice('sha256:'.length),
      url,
    };
  }
}

export function runtimePlatformKey(
  platform = process.platform,
  architecture = process.arch,
): RuntimePlatformKey {
  const key = `${platform}-${architecture}`;
  if (
    key === 'darwin-arm64'
    || key === 'win32-x64'
    || key === 'linux-x64'
    || key === 'linux-arm64'
  ) {
    return key;
  }
  throw new PluginRuntimeError(
    'RUNTIME_UNAVAILABLE',
    `ZVec Hybrid Search does not provide a runtime for ${platform} ${architecture}.`,
  );
}

export function runtimeAssetName(
  version: string,
  platformKey: RuntimePlatformKey,
): string {
  return `zvec-runtime-${version}-${platformKey}.zip`;
}

export function isExpectedRuntimeAssetUrl(
  url: URL,
  version: string,
  assetName: string,
): boolean {
  return RELEASE_REPOSITORIES.some((repository) => {
    const expected = new URL(
      `https://github.com/${repository}/releases/download/${encodeURIComponent(version)}/${assetName}`,
    );
    return url.href === expected.href;
  });
}

export function runtimeNodeRelativePath(
  platformKey: RuntimePlatformKey,
): string {
  return platformKey.startsWith('win32-') ? 'bin/node.exe' : 'bin/node';
}

async function validateRuntimeInstallation(
  rootDirectory: string,
  version: string,
  platformKey: RuntimePlatformKey,
): Promise<RuntimeInstallation | null> {
  try {
    const marker = JSON.parse(
      await readFile(join(rootDirectory, READY_FILE), 'utf8'),
    ) as RuntimeReadyMarker;
    if (
      marker.version !== version
      || marker.platformKey !== platformKey
      || (
        marker.source !== 'github-release'
        && marker.source !== 'local-development'
      )
    ) {
      return null;
    }
    await validateRuntimePayload(rootDirectory, platformKey);
    return {
      rootDirectory,
      nodeExecutable: join(
        rootDirectory,
        ...runtimeNodeRelativePath(platformKey).split('/'),
      ),
      platformKey,
    };
  } catch {
    return null;
  }
}

async function validateRuntimePayload(
  rootDirectory: string,
  platformKey: RuntimePlatformKey,
): Promise<void> {
  const nodeExecutable = join(
    rootDirectory,
    ...runtimeNodeRelativePath(platformKey).split('/'),
  );
  const requiredFiles = [
    nodeExecutable,
    join(rootDirectory, 'package.json'),
    join(rootDirectory, 'node_modules', '@zvec', 'zvec', 'package.json'),
    join(
      rootDirectory,
      'node_modules',
      '@huggingface',
      'transformers',
      'package.json',
    ),
  ];
  for (const file of requiredFiles) {
    const details = await stat(file);
    if (!details.isFile() || details.size === 0) {
      throw new Error(`Runtime file is missing or empty: ${file}`);
    }
  }
  if (!platformKey.startsWith('win32-')) {
    await chmod(nodeExecutable, 0o755);
  }
}

async function getJson<T>(
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
): Promise<T> {
  const response = await openHttps(url, signal);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response as AsyncIterable<unknown>) {
    throwIfAborted(signal);
    const buffer = responseChunkToBuffer(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      response.destroy();
      throw new Error('Release metadata exceeded its size limit.');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

async function downloadToFile(
  url: URL,
  destination: string,
  expectedBytes: number,
  signal: AbortSignal,
  onProgress: (completed: number) => void,
): Promise<string> {
  const response = await openHttps(url, signal, DOWNLOAD_TIMEOUT_MS);
  const declaredLength = Number(response.headers['content-length']);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > 0
    && declaredLength !== expectedBytes
  ) {
    response.destroy();
    throw new Error('Runtime download size does not match release metadata.');
  }
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  let completed = 0;
  let lastProgressAt = 0;
  response.on('data', (chunk: Buffer) => {
    completed += chunk.length;
    if (completed > expectedBytes || completed > MAX_ARCHIVE_BYTES) {
      response.destroy(new Error('Runtime download exceeded its size limit.'));
      return;
    }
    hash.update(chunk);
    const now = Date.now();
    if (completed === expectedBytes || now - lastProgressAt >= 200) {
      lastProgressAt = now;
      onProgress(completed);
    }
  });
  await pipeline(response, output, { signal });
  if (completed !== expectedBytes) {
    throw new Error(
      `Runtime download was incomplete (${completed} of ${expectedBytes} bytes).`,
    );
  }
  return hash.digest('hex');
}

async function openHttps(
  initialUrl: URL,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
  redirectCount = 0,
): Promise<IncomingMessage> {
  throwIfAborted(signal);
  assertAllowedUrl(initialUrl);
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(initialUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'zvec-hybrid-search-obsidian-plugin',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (
        status >= 300
        && status < 400
        && typeof response.headers.location === 'string'
      ) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('Runtime download exceeded its redirect limit.'));
          return;
        }
        let redirected: URL;
        try {
          redirected = new URL(response.headers.location, initialUrl);
          assertAllowedUrl(redirected);
        } catch (error) {
          reject(toError(error));
          return;
        }
        void openHttps(
          redirected,
          signal,
          timeoutMs,
          redirectCount + 1,
        ).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`GitHub returned HTTP ${status}.`));
        return;
      }
      resolve(response);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Runtime network request timed out.'));
    });
    request.once('error', reject);
  });
}

export async function extractZipSafely(
  archivePath: string,
  destination: string,
  signal: AbortSignal,
): Promise<void> {
  const zipFile = await openZip(archivePath);
  let entries = 0;
  let extractedBytes = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(toError(error));
    };
    zipFile.once('error', fail);
    zipFile.once('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zipFile.on('entry', (entry: Entry) => {
      void extractEntry(entry).catch(fail);
    });

    async function extractEntry(entry: Entry): Promise<void> {
      throwIfAborted(signal);
      entries += 1;
      extractedBytes += entry.uncompressedSize;
      if (entries > MAX_ZIP_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error('Runtime archive exceeded its extraction limits.');
      }
      const relativePath = safeZipEntryPath(entry.fileName);
      if (isZipSymlink(entry)) {
        throw new Error(`Runtime archive contains a symbolic link: ${relativePath}`);
      }
      const outputPath = join(destination, ...relativePath.split('/'));
      if (entry.fileName.endsWith('/')) {
        await mkdir(outputPath, { recursive: true });
        zipFile.readEntry();
        return;
      }
      await mkdir(dirname(outputPath), { recursive: true });
      const input = await openZipEntry(zipFile, entry);
      const output = createWriteStream(outputPath, {
        flags: 'wx',
        mode: executableMode(entry),
      });
      await pipeline(input, output, { signal });
      zipFile.readEntry();
    }

    zipFile.readEntry();
  });
}

function responseChunkToBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array || typeof chunk === 'string') {
    return Buffer.from(chunk);
  }
  throw new Error('Runtime download returned an unsupported data chunk.');
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(errorMessage(reason));
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, {
      lazyEntries: true,
      autoClose: true,
      decodeStrings: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error('Could not open runtime archive.'));
      else resolve(zipFile);
    });
  });
}

function openZipEntry(zipFile: ZipFile, entry: Entry): Promise<ReadStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error('Could not read runtime archive entry.'));
      else resolve(stream as ReadStream);
    });
  });
}

export function safeZipEntryPath(fileName: string): string {
  const slashPath = fileName.replaceAll('\\', '/');
  const segments = slashPath.split('/');
  const normalized = normalize(slashPath).split(sep).join('/');
  if (
    !slashPath
    || slashPath.startsWith('/')
    || /^[A-Za-z]:/u.test(slashPath)
    || segments.includes('..')
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || normalized.includes('\0')
  ) {
    throw new Error(`Unsafe runtime archive entry: ${fileName}`);
  }
  return normalized.replace(/\/$/u, '');
}

function isZipSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

function executableMode(entry: Entry): number {
  const archivedMode = (entry.externalFileAttributes >>> 16) & 0o777;
  return archivedMode === 0 ? 0o644 : archivedMode;
}

function assertAllowedUrl(url: URL): void {
  if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing unexpected runtime download host: ${url.hostname}`);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Operation cancelled.');
  }
}

function humanPlatformName(platformKey: RuntimePlatformKey): string {
  const names: Record<RuntimePlatformKey, string> = {
    'darwin-arm64': 'macOS Apple silicon',
    'win32-x64': 'Windows x64',
    'linux-x64': 'Linux x64',
    'linux-arm64': 'Linux ARM64',
  };
  return names[platformKey];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

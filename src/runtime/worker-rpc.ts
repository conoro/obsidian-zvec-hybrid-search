import {
  spawn,
  type ChildProcess,
} from 'node:child_process';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import {
  errorMessage,
  PluginRuntimeError,
  type PluginErrorCode,
} from './safety';

interface WorkerRequest {
  id: number;
  method: string;
  args: unknown;
}

interface WorkerSuccess {
  id: number;
  ok: true;
  result: unknown;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: {
    message: string;
    stack?: string;
  };
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type WorkerProgressHandler = (message: unknown) => void;
export type WorkerFailureHandler = (error: Error) => void;
const MAX_PENDING_REQUESTS = 128;

export class WorkerRpcClient {
  private readonly transport: Worker | ChildProcess;
  private readonly childProcess: boolean;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private stopped = false;
  private failed = false;

  constructor(
    source: string,
    workerData: unknown,
    private readonly onFailure: WorkerFailureHandler,
    private readonly onProgress?: WorkerProgressHandler,
    forceChildProcess = false,
    nodeExecutable?: string,
  ) {
    this.childProcess = forceChildProcess || Boolean(process.versions.electron);
    this.transport = this.childProcess
      ? createElectronNodeChild(source, workerData, nodeExecutable)
      : new Worker(source, { eval: true, workerData });
    if (this.transport instanceof Worker) {
      this.transport.unref();
    }
    this.transport.on('message', (message: unknown) => this.handleMessage(message));
    this.transport.on('error', (error) => this.fail(
      new PluginRuntimeError(
        'WORKER_ERROR',
        `The isolated plugin process failed: ${errorMessage(error)}`,
        { cause: error, retryable: true },
      ),
    ));
    this.transport.on('exit', (code, signal) => {
      if (!this.stopped) {
        this.fail(new PluginRuntimeError(
          'WORKER_ERROR',
          `The isolated plugin process exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`,
          { retryable: true },
        ));
      }
    });
  }

  request<T>(
    method: string,
    args: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (this.stopped || this.failed) {
      return Promise.reject(new PluginRuntimeError(
        'PLUGIN_STOPPED',
        'The isolated ZVec worker is not running.',
        { retryable: true },
      ));
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new PluginRuntimeError(
        'RUNTIME_UNAVAILABLE',
        'The isolated ZVec worker queue is full.',
        { retryable: true },
      ));
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new PluginRuntimeError(
          'OPERATION_TIMEOUT',
          `ZVec ${method} timed out after ${Math.ceil(timeoutMs / 1000)} seconds. The worker was stopped to protect Obsidian.`,
          { retryable: true },
        );
        this.pending.delete(id);
        reject(error);
        this.fail(error);
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        this.send({ id, method, args } satisfies WorkerRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new PluginRuntimeError(
          'WORKER_ERROR',
          `Could not send ${method} to the isolated ZVec worker.`,
          { cause: error, retryable: true },
        ));
      }
    });
  }

  async stop(timeoutMs = 1000): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.rejectPending(new PluginRuntimeError(
      'PLUGIN_STOPPED',
      'The ZVec plugin is stopping.',
    ));
    const termination = this.terminateTransport();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        termination,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) return;
    if (message.kind === 'progress') {
      this.onProgress?.(message.value);
      return;
    }
    if (typeof message.id !== 'number' || typeof message.ok !== 'boolean') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve((message as unknown as WorkerSuccess).result);
      return;
    }
    const failure = message as unknown as WorkerFailure;
    const workerMessage = failure.error?.message || 'Unknown worker error';
    pending.reject(new PluginRuntimeError(
      operationErrorCode(pending.method),
      `ZVec ${pending.method} failed: ${workerMessage}`,
      { retryable: true },
    ));
  }

  private fail(error: Error): void {
    if (this.failed || this.stopped) return;
    this.failed = true;
    this.rejectPending(error);
    void this.terminateTransport().catch((terminationError) => {
      console.error(
        'ZVec Hybrid Search could not terminate its failed worker',
        terminationError,
      );
    });
    this.onFailure(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private send(request: WorkerRequest): void {
    if (this.transport instanceof Worker) {
      this.transport.postMessage(request);
      return;
    }
    if (!this.transport.connected || !this.transport.send) {
      throw new Error('The isolated plugin process IPC channel is closed.');
    }
    this.transport.send(request, (error) => {
      if (error) this.fail(new PluginRuntimeError(
        'WORKER_ERROR',
        `Could not communicate with the isolated plugin process: ${error.message}`,
        { cause: error, retryable: true },
      ));
    });
  }

  private async terminateTransport(): Promise<void> {
    if (this.transport instanceof Worker) {
      await this.transport.terminate();
      return;
    }
    const child = this.transport;
    if (child.connected) {
      try {
        child.disconnect();
      } catch (error) {
        console.warn('Could not disconnect isolated plugin IPC', error);
      }
    }
    if (child.exitCode !== null || child.killed) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        resolve();
      }, 500);
      child.once('exit', () => {
        clearTimeout(forceTimer);
        resolve();
      });
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function operationErrorCode(method: string): PluginErrorCode {
  return method === 'open' || method === 'recreate'
    ? 'RUNTIME_UNAVAILABLE'
    : 'STORAGE_ERROR';
}

export function serializeWorkerError(error: unknown): {
  message: string;
  stack?: string;
} {
  return {
    message: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function createElectronNodeChild(
  source: string,
  workerData: unknown,
  nodeExecutable?: string,
): ChildProcess {
  const child = spawn(
    resolveIsolatedNodeExecutable(nodeExecutable),
    ['-e', source],
    {
      env: {
        ...process.env,
        OBSIDIAN_ZVEC_CHILD_DATA: JSON.stringify(workerData),
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
      windowsHide: true,
    },
  );
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });
  child.once('exit', (code, signal) => {
    if ((code || signal) && stderr) {
      console.error('ZVec Hybrid Search isolated process stderr', stderr);
    }
  });
  return child;
}

function resolveIsolatedNodeExecutable(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  if (!process.versions.electron && existsSync(process.execPath)) {
    return process.execPath;
  }
  throw new PluginRuntimeError(
    'RUNTIME_UNAVAILABLE',
    'The private Node runtime is unavailable. Retry runtime installation from the plugin settings.',
    { retryable: true },
  );
}

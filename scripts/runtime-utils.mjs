import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export function runtimePlatformKey(
  platform = process.platform,
  architecture = process.arch,
) {
  const key = `${platform}-${architecture}`;
  if (
    key === 'darwin-arm64'
    || key === 'win32-x64'
    || key === 'linux-x64'
    || key === 'linux-arm64'
  ) {
    return key;
  }
  throw new Error(`Unsupported release platform: ${key}`);
}

export function nodeRelativePath(platformKey) {
  return platformKey.startsWith('win32-') ? 'bin/node.exe' : 'bin/node';
}

export function runtimePackageJson(projectPackage) {
  return {
    name: 'zvec-hybrid-search-private-runtime',
    version: projectPackage.version,
    private: true,
    description: 'Platform runtime used only by ZVec Hybrid Search.',
    dependencies: projectPackage.dependencies,
    overrides: projectPackage.overrides,
  };
}

export function installNodeExecutable(destination, platformKey) {
  const relativePath = nodeRelativePath(platformKey);
  const output = join(destination, ...relativePath.split('/'));
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(realpathSync(process.execPath), output);
  if (!platformKey.startsWith('win32-')) chmodSync(output, 0o755);
  return output;
}

export function pruneUnusedPlatformPayloads(nodeModules, platform, architecture) {
  rmSync(join(nodeModules, '.bin'), { recursive: true, force: true });
  rmSync(join(nodeModules, '@types'), { recursive: true, force: true });
  rmSync(join(nodeModules, 'onnxruntime-web'), { recursive: true, force: true });

  const onnxPlatforms = join(nodeModules, 'onnxruntime-node', 'bin', 'napi-v6');
  if (existsSync(onnxPlatforms)) {
    for (const candidatePlatform of readdirSync(onnxPlatforms)) {
      const platformPath = join(onnxPlatforms, candidatePlatform);
      if (candidatePlatform !== platform) {
        rmSync(platformPath, { recursive: true, force: true });
        continue;
      }
      for (const candidateArchitecture of readdirSync(platformPath)) {
        if (candidateArchitecture !== architecture) {
          rmSync(join(platformPath, candidateArchitecture), {
            recursive: true,
            force: true,
          });
        }
      }
    }
  }
  if (platform === 'linux' && architecture === 'x64') {
    const onnxLinuxX64 = join(onnxPlatforms, 'linux', 'x64');
    // Transformers.js selects ONNX CPU on Node. The npm package also ships
    // optional CUDA/TensorRT providers; they add over 300 MB and cannot be
    // used without external NVIDIA libraries.
    rmSync(join(onnxLinuxX64, 'libonnxruntime_providers_cuda.so'), {
      force: true,
    });
    rmSync(join(onnxLinuxX64, 'libonnxruntime_providers_tensorrt.so'), {
      force: true,
    });
  }

  const imagePackages = join(nodeModules, '@img');
  if (existsSync(imagePackages)) {
    for (const packageName of readdirSync(imagePackages)) {
      if (
        packageName !== 'colour'
        && !packageName.endsWith(`${platform}-${architecture}`)
      ) {
        rmSync(join(imagePackages, packageName), {
          recursive: true,
          force: true,
        });
      }
    }
  }
}

export function assertRuntimeHasNoSymlinks(root) {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Runtime payload contains a symbolic link: ${path}`);
      }
      const details = statSync(path, { throwIfNoEntry: true });
      if (details.isDirectory()) pending.push(path);
    }
  }
}

export function writeReadyMarker(
  root,
  version,
  platformKey,
  source = 'local-development',
) {
  writeFileSync(
    join(root, '.ready.json'),
    `${JSON.stringify({
      version,
      platformKey,
      source,
    }, null, 2)}\n`,
    'utf8',
  );
}

export async function writeNodeLicense(root) {
  const executable = realpathSync(process.execPath);
  const candidates = [
    join(dirname(executable), 'LICENSE'),
    join(dirname(dirname(executable)), 'LICENSE'),
    join(dirname(dirname(executable)), 'LICENSE.md'),
  ];
  const localLicense = candidates.find((candidate) => existsSync(candidate));
  const output = join(root, 'NODE-LICENSE');
  if (localLicense) {
    copyFileSync(localLicense, output);
    return;
  }
  let response = await fetch(
    `https://nodejs.org/download/release/${process.version}/LICENSE`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) {
    response = await fetch(
      `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
      { signal: AbortSignal.timeout(30_000) },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not download the Node.js license (HTTP ${response.status}).`,
    );
  }
  const text = await response.text();
  if (text.length < 1000 || !text.includes('Node.js')) {
    throw new Error('The downloaded Node.js license was malformed.');
  }
  writeFileSync(output, text, 'utf8');
}

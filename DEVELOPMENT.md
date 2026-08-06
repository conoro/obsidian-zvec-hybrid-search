# Development

This document covers source builds, tests, architecture, and release work.
User-facing instructions live in [README.md](README.md).

## Requirements

- Node.js 22 or newer
- npm
- Obsidian desktop
- A test vault

Do not develop against an irreplaceable vault. Native database and embedding
code is isolated from Obsidian, but plugin development should still use a
backed-up test vault.

## Set up

```bash
npm install
npm run verify
```

Install the current build into a vault:

```bash
npm run install:local -- --vault "/path/to/Vault"
```

Alternatively:

```bash
OBSIDIAN_VAULT="/path/to/Vault" npm run install:local
```

The installer copies the production plugin files and creates the same private,
self-contained runtime layout used by releases. Obsidian does not use the
developer's system Node installation after that. Runtime, model, collection,
and index-state files live in the operating system's local application-data
directory rather than inside the vault.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch and rebuild `main.js` |
| `npm run build` | Create a minified production `main.js` |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run unit, robustness, and ZVec integration tests |
| `npm run verify` | Typecheck, test, and build |
| `npm run install:local -- --vault …` | Install into a local vault |
| `npm run package:runtime -- --target …` | Build and smoke-test this machine's native runtime |

Generated `main.js` files are intentionally ignored in Git and belong in
release assets, not source commits.

## Architecture

- `main.ts` owns lifecycle, commands, view registration, and vault events.
- `src/indexing/` contains incremental indexing and reconciliation.
- `src/search/` contains chunking, embeddings, ZVec storage, and ranking.
- `src/runtime/` contains timeouts and isolated worker-process management.
- `src/runtime/data-directory.ts` owns the machine-local per-vault storage
  location and one-time migration from the older in-vault layout.
- `src/ui/` contains the sidebar and plugin settings.
- `test/` contains synthetic-vault and failure-containment tests.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the detailed design and
publication roadmap.

## Release architecture

Obsidian's installer downloads `main.js`, `manifest.json`, and `styles.css`.
On first use, `RuntimeManager` selects the current platform and requests the
corresponding archive from the release whose tag exactly matches the plugin
version. It accepts only this repository's expected GitHub URL, reads GitHub's
release-asset SHA-256 digest, streams the archive to disk, verifies the digest,
extracts it into a staging directory, validates required files, and renames it
into place.

Each archive contains Node 22, ZVec, Transformers.js, and only the target
platform's native ZVec and ONNX payloads. The runtime remains private to the
plugin. ZVec and embeddings execute in separate subprocesses with bounded IPC,
timeouts, shutdown, and crash containment.

`.github/workflows/platform-runtimes.yml` builds and loads both native
libraries on macOS ARM64, Windows x64, Linux x64, and Linux ARM64.
`.github/workflows/release.yml` repeats those tests for a version tag and
publishes only after every platform succeeds.

## Versioning

- `0.x.y`: developer previews and public betas
- `1.x.y`: stable releases for Community Plugin distribution

Obsidian release tags must match the version in `manifest.json` exactly and
must not use a `v` prefix.

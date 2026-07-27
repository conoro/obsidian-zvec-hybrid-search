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

The installer copies the production plugin files, installs runtime
dependencies inside the plugin directory, and removes native payloads for
platforms other than the current machine.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch and rebuild `main.js` |
| `npm run build` | Create a minified production `main.js` |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run unit, robustness, and ZVec integration tests |
| `npm run verify` | Typecheck, test, and build |
| `npm run install:local -- --vault …` | Install into a local vault |

Generated `main.js` files are intentionally ignored in Git and belong in
release assets, not source commits.

## Architecture

- `main.ts` owns lifecycle, commands, view registration, and vault events.
- `src/indexing/` contains incremental indexing and reconciliation.
- `src/search/` contains chunking, embeddings, ZVec storage, and ranking.
- `src/runtime/` contains timeouts and isolated worker-process management.
- `src/ui/` contains the sidebar and plugin settings.
- `test/` contains synthetic-vault and failure-containment tests.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the detailed design and
publication roadmap.

## Release status

Obsidian's standard installer downloads only `main.js`, `manifest.json`, and
`styles.css`. ZVec and ONNX Runtime include native binaries, while the current
build deliberately keeps them outside `main.js` and executes them in isolated
processes.

As a result, the current preview cannot yet be installed correctly through
BRAT or the Community Plugin directory. A public production release needs:

1. Self-contained, checksummed runtime payloads for supported desktop
   platforms.
2. A supported isolated runtime that does not require users to install
   Node.js.
3. Automated packaging and smoke tests for macOS ARM64, Windows x64, Linux
   x64, and Linux ARM64.
4. Release assets named exactly as required by Obsidian.
5. Review against Obsidian's developer policies and plugin checklist.

Until that packaging work is complete, releases should be marked as GitHub
pre-releases and must not claim BRAT or Community Plugin compatibility.

## Versioning

- `0.x.y`: developer previews and public betas
- `1.0.0`: stable Community Plugin release after cross-platform packaging,
  review, and a beta period

Obsidian release tags must match the version in `manifest.json` exactly and
must not use a `v` prefix.

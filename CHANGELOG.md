# Changelog

All notable changes to ZVec Hybrid Search are documented here.

## 0.2.0 — 2026-07-27

First installable public beta.

### Added

- Self-contained private runtimes for macOS ARM64, Windows x64, Linux x64,
  and Linux ARM64.
- Automatic first-run runtime selection, download, SHA-256 verification,
  traversal-safe extraction, atomic installation, and reuse.
- Native release builds and smoke tests on all four target architectures.
- A single plugin zip for straightforward manual installation.

### Reliability

- Runtime provisioning runs asynchronously and never blocks Obsidian startup.
- Downloads have size, redirect, host, inactivity, and total-duration bounds.
- Failed setup is contained inside the plugin and uses a retry cooldown.
- Plugin unload and the visible Cancel action abort runtime provisioning.
- ZVec and ONNX continue to run in separate private child processes, so native
  faults remain outside Obsidian's renderer.
- Obsidian no longer uses or searches for a system Node.js installation.

### Network and storage

- The first launch downloads the matching platform runtime from this GitHub
  release. The archive is currently about 75–100 MB depending on platform.
- The semantic model remains a separate one-time download from Hugging Face.
- Runtime, model, index, and settings are stored inside the plugin directory.

## 0.1.1 — 2026-07-27

### Changed

- Refocused project descriptions and documentation on local hybrid retrieval,
  indexing, and search controls.
- Documented all-term matching as a configurable default.

## 0.1.0 — 2026-07-27

Initial public developer preview.

### Added

- Hybrid, keyword, and semantic search backed by ZVec.
- Configurable all-term, any-term, and exact-phrase matching.
- BM25 full-text search, MiniLM semantic embeddings, and hybrid ranking.
- Sort order, result grouping, match mode, and result-limit controls.
- Whole-vault or selected-folder indexing with vault-relative exclusions.
- Debounced incremental updates for note creation, modification, deletion,
  and rename events.
- Local settings, model cache, index status, cancellation, and rebuild tools.

### Reliability and efficiency

- ZVec and embedding work run in isolated child processes with bounded
  timeouts, cancellation, and failure containment.
- Missing or disconnected vault storage is contained within the plugin.
- The embedding process shuts down after 10 minutes without work and restarts
  automatically when needed.
- Vault events are registered only after Obsidian finishes loading.
- Background safety reconciliation runs hourly; ordinary updates remain
  event-driven.
- Malformed settings, oversized notes, state writes, shutdown, and worker
  failures have explicit safeguards.

### Distribution status

- This version is an early developer preview, not a Community Plugin release.
- Installation currently requires building from source with Node.js 22 or
  newer.
- Native cross-platform release packaging remains required before BRAT or the
  Obsidian Community Plugin installer can install the plugin.

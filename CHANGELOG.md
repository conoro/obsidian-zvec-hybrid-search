# Changelog

All notable changes to ZVec Hybrid Search are documented here.

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

# ZVec Hybrid Search for Obsidian — implementation plan

## Goal

Build a desktop-only Obsidian Community Plugin that replaces the normal search
workflow with a fast right-sidebar search powered by
[ZVec](https://github.com/alibaba/zvec). The plugin must require no manually
started server, keep the vault contents local, and make unquoted multi-term
searches use `AND` by default.

Development installs accept any vault path through `--vault` or the
`OBSIDIAN_VAULT` environment variable; no user-specific path is compiled into
the plugin or its tooling.

## Product scope

The first complete version will provide:

- A native Obsidian right-sidebar search view, ribbon button, and command.
- Incremental indexing of Markdown notes, with create/modify/delete/rename
  events handled automatically.
- A settings screen for selecting the whole vault or any combination of
  top-level folders.
- ZVec BM25 full-text search with explicit `AND`, `OR`, and phrase modes.
- Local semantic embeddings using MiniLM through Transformers.js. The model is
  downloaded automatically on first use and cached locally; no service or
  Python runtime is required.
- Hybrid ranking that combines ZVec full-text, title, and dense-vector
  retrieval.
- Sort controls for relevance, modified date, created date, and title.
- Note-level or passage-level results, snippets, term highlighting, result
  counts, and click-to-open behavior.
- Progress, error, cancellation, reindex, and reset-index controls.
- Local-only index and model storage inside the plugin directory.

## Architecture

### Obsidian layer

`main.ts` owns plugin lifecycle, commands, view registration, settings, and
vault event subscriptions. `HybridSearchView` renders the sidebar using
Obsidian-native DOM APIs and CSS so it follows the active theme.

### Indexing layer

`VaultIndexer`:

1. Selects Markdown files from the configured top-level folders.
2. Splits notes into heading-aware passages with bounded overlap.
3. Extracts title, heading, path, timestamps, tags, and a display snippet.
4. Creates local MiniLM embeddings in batches.
5. Coalesces Obsidian create, modify, delete, and rename events into a
   debounced queue of vault-relative paths.
6. Upserts only changed passages into ZVec and removes stale passages.
7. Persists a compact file fingerprint manifest for incremental updates.
8. Drains changes that arrive during an active run before becoming idle.
9. Optimizes after 45 idle seconds or 100 affected passages, and performs a
   full safety reconciliation at startup and every hour.

All native ZVec operations execute in a dedicated Node subprocess. The renderer
communicates through a bounded request/response queue with per-operation
timeouts. Transformers/ONNX embedding runs in a separate subprocess so model
loading or inference cannot block Obsidian. A stalled process is terminated and
the plugin enters a retryable local error state without throwing into Obsidian.
The embedding subprocess shuts down after 10 idle minutes and restarts on
demand.

The index schema stores full text and title fields with ZVec FTS indexes,
metadata fields with scalar/inverted indexes, and a 384-dimensional dense
vector with an HNSW cosine index.

### Retrieval layer

`HybridSearchEngine` exposes three user-facing modes:

- **Hybrid**: BM25 content + BM25 title + MiniLM vector candidates, fused by
  reciprocal-rank fusion.
- **Keywords**: ZVec BM25 only.
- **Semantic**: MiniLM vector similarity only.

For the default **All terms** match mode, a ZVec FTS query with
`defaultOperator: "AND"` is the mandatory candidate set. Hybrid signals may
rerank those candidates but may not reintroduce notes that omit a query term.
This makes the requested `AND` behavior a hard invariant rather than a ranking
preference.

### Storage

```text
.obsidian/plugins/zvec-hybrid-search/
├── main.js
├── manifest.json
├── styles.css
├── data.json
├── search-data/
│   ├── collection/
│   ├── index-state.json
│   └── models/
└── node_modules/              # local-development install only
```

Vault Markdown is never sent to an API. The one expected network operation is
the initial download of the selected embedding model from Hugging Face.

## Implementation phases

### Phase 1 — repository and build

- Initialize Git with `main` as the default branch.
- Add the Obsidian manifest, TypeScript configuration, esbuild configuration,
  lint/test scripts, version metadata, license, and ignore rules.
- Add a local installer targeting the configured vault.

**Exit criteria:** clean install, typecheck, test, and production build commands
work from a fresh checkout.

### Phase 2 — core indexing

- Add ZVec collection creation/opening and schema-version checks.
- Add heading-aware Markdown chunking and stable passage IDs.
- Add local embedding generation, batching, cache configuration, and fallback
  diagnostics.
- Add initial and incremental indexing with progress events and cancellation.
- Add safe index rebuild when folders, chunking, model, or schema change.

**Exit criteria:** a synthetic vault survives create/modify/rename/delete
cycles without stale results.

### Phase 3 — search behavior

- Implement keyword, semantic, and hybrid retrieval.
- Enforce `AND` as the default multi-term behavior.
- Add phrase and `OR` modes.
- Add note/passages grouping and every supported sort order.
- Add deterministic tie-breaking and empty/error states.

**Exit criteria:** automated tests prove that `alpha beta` excludes a note that
only contains `alpha` in All-terms mode.

### Phase 4 — Obsidian UI

- Add the sidebar, ribbon icon, command palette command, and keyboard focus.
- Add query, mode, match, sort, grouping, result-count, clear, and reindex
  controls.
- Add highlighted snippets and open-note behavior.
- Add the settings screen with top-level folder selection and index controls.
- Add theme-aware responsive styles and keyboard-accessible controls.

**Exit criteria:** the primary search workflow requires no terminal or browser.

### Phase 5 — validation and local installation

- Run typecheck, unit tests, production build, and dependency audit.
- Probe the real ZVec native binding on macOS ARM64.
- Install into the target vault and verify the expected plugin files and
  runtime dependencies are present.
- Document first-run model download and indexing behavior.

**Exit criteria:** enable the plugin in Obsidian and search without starting any
external process.

## Community Plugin release constraint

ZVec's official Node SDK is in-process but ships a roughly 39 MB native
platform binding. Obsidian's Community Plugin installer only downloads
`main.js`, `manifest.json`, and `styles.css`, so normal `node_modules`
deployment is not a publishable final format.

Before submitting to the Community Plugin directory, the release build must
produce a self-contained `main.js` that contains compressed, checksummed native
payloads and extracts only the current platform's binding into the plugin data
directory. The same treatment is required for ONNX Runtime, or the semantic
backend must use a WebAssembly payload. Release CI must build and test macOS
ARM64, Windows x64, Linux x64, and Linux ARM64 payloads. This packaging work is
separate from the local-development installer but is part of the publication
roadmap.

## Validation checklist

- [ ] No companion server, daemon, Docker container, or Python process.
- [ ] Default multi-term searches are strict `AND`.
- [ ] Whole-vault and top-level-folder indexing both work.
- [ ] Initial indexing reports progress and can be cancelled.
- [ ] Edits, creates, deletes, and renames update results automatically.
- [ ] Hybrid, keyword, and semantic modes return stable results.
- [ ] All sort and grouping options work in the sidebar.
- [ ] Reindex and reset recover from stale or incompatible index data.
- [ ] Vault contents and embeddings stay on the local machine.
- [ ] Production build and tests pass.
- [x] Local installer accepts any explicitly supplied vault.
- [ ] Community release packaging has no undeclared runtime dependency.
- [x] Native database and embedding failures are isolated from the renderer.
- [x] Missing/unavailable storage fails within a bounded plugin operation.
- [x] Hung-process, malformed-settings, and clean-shutdown paths are tested.

## Sources checked

- ZVec 0.6 documentation and Node.js API reference.
- ZVec native full-text and hybrid retrieval documentation.
- Obsidian sample plugin and Community Plugin release requirements.
- Transformers.js Node/Electron and model-cache documentation.

# Changelog

All notable changes to ZVec Hybrid Search for Obsidian are documented here.

## 1.0.1 — 2026-08-06

### Changed

- Updated the README now that ZVec Hybrid Search is published in the Obsidian
  Community Plugin Directory.
- Installation instructions now present the Community Plugin Directory, BRAT,
  and manual installation as three clear alternatives.

## 1.0.0 — 2026-08-06

### Added

- Settings are searchable in Obsidian 1.13 and newer through the declarative
  settings API. The existing settings renderer remains available on Obsidian
  1.8 through 1.12.
- GitHub release assets now receive signed build-provenance attestations.
- Release verification now checks vaults whose Obsidian configuration folder
  has a custom name.

### Changed

- The plugin uses `Vault.configDir` when excluding Obsidian's configuration
  folder instead of assuming that it is named `.obsidian`.
- Isolated workers load Node built-ins through the bundled Node 22 runtime
  without forbidden `require()` syntax.
- The build uses Node's built-in module list instead of the deprecated
  `builtin-modules` package.
- README installation wording now describes the stable GitHub release while
  the Community Plugin submission is being completed.

### Fixed

- Plugin shutdown no longer returns a promise to Obsidian's synchronous
  lifecycle hook; bounded cleanup continues safely in the background.
- Workspace navigation and background operations now handle promises
  explicitly.
- Runtime downloads validate untyped stream chunks before passing them to
  typed buffer APIs, and all promise rejections use `Error` instances.
- Timers use the active window APIs for popout-window compatibility.
- Deprecated settings controls, an unnecessary migration log, unused imports,
  and the reported CSS compatibility warnings have been removed.

### Verification

- Type checking, production build, 52 automated tests, and a production
  dependency audit pass. Official Obsidian source lint completes without
  errors.

## 0.3.0 — 2026-08-06

### Changed

- Reworked the README around Community Plugin installation, removed
  version-specific beta text, corrected the stale manual-download link, and
  documented the first-run runtime download and local storage more clearly.
- Runtime initialization now waits until Obsidian's workspace layout is ready.
- Command identifiers no longer repeat the plugin identifier, as required for
  Community Plugin submission. Existing beta users who assigned custom
  hotkeys to these commands will need to assign them again after updating.
- Automatic indexing settings no longer claim that the disabled ZVec
  optimization task runs in the background.
- Future tagged builds are published as normal GitHub releases rather than
  prereleases.

## 0.2.12 — 2026-08-05

### Added

- YAML front-matter property names and values are now indexed, including web
  clipping metadata such as authors, descriptions, sources, publication dates,
  aliases, and tags.
- Metadata is represented as a dedicated **Properties** passage, giving author
  and other property matches a useful result preview without mixing YAML into
  normal note previews.
- Notes containing front matter but no body text are searchable too.

### Changed

- This release performs a one-time index rebuild to add Properties passages.
  Later note changes continue to use automatic incremental indexing.

### Verification

- Type checking, production build, and 51 automated tests pass, including an
  end-to-end ZVec search for an author absent from the note body.
- A live rebuild added 485 Properties passages to a 1,125-note vault. A real
  web clipping was then found using its front-matter-only author, with the
  matching property shown in the result preview.

## 0.2.11 — 2026-08-05

### Added

- Search options now include independent **Modified from** and **Modified to**
  date fields. Leaving both blank searches all dates, while either field can be
  used on its own. The To date includes the complete selected day.
- Date conditions run inside ZVec before keyword, semantic, and hybrid ranking,
  so filtered searches are not limited to an already-truncated candidate list.

### Documentation

- Clarified that titles, headings, note content, and Obsidian tags are searched.
  Other YAML front-matter properties are not currently indexed.

### Verification

- Type checking, production build, and 49 automated tests pass.
- A live Obsidian test reused the existing 13,150-passage index without a
  rebuild. A From-only filter reduced a 56-result query to one result in 56 ms.

## 0.2.10 — 2026-07-31

### Fixed

- Automatic indexing no longer calls ZVec's optional collection optimisation.
  Its FTS reducer could reject valid incremental segments with `source postings
  is not BitPacked`, leaving a healthy searchable index behind a red failure
  status.
- Native stderr is retained when a worker returns an empty error message, so
  useful diagnostics are no longer replaced by `Unknown worker error`.
- Sidebar errors now remain visible until indexing completes successfully and
  include a **Copy error** button. Error details can also be selected directly.

### Verification

- Search integration tests confirm that ZVec upserts, deletes, and queries work
  without an explicit optimisation pass.
- Type checking, production build, and 43 automated tests pass.

## 0.2.9 — 2026-07-31

### Fixed

- Generated runtime, model, ZVec collection, and index-state files now live in
  the operating system's local application-data directory. Dropbox, iCloud,
  OneDrive, and other vault sync services no longer manage the native database.
- ZVec and embedding child processes now close when Obsidian disconnects or
  exits. A lost parent process can no longer leave background indexing running
  and consuming CPU.
- The indexer is no longer visible to startup callbacks until its saved state
  has loaded. This closes a race that could recreate a healthy collection on
  every Obsidian launch.
- Failure to open an existing collection is now contained and reported. The
  plugin never replaces that collection with an empty one after an open error.

### Changed

- Existing generated data is copied once from the older in-vault location.
  The legacy copy is left untouched as a recovery fallback.
- Startup storage migration is staged and marked complete atomically. An
  interrupted copy is discarded without modifying either complete copy.

### Verification

- Type checking, production build, and 42 automated tests cover local storage,
  interrupted migration, child-process shutdown, open failure containment, and
  initialization ordering.
- Two full Obsidian quit-and-relaunch tests reused all 13,019 passages from
  1,113 notes, including after the delayed startup reconciliation.

## 0.2.8 — 2026-07-30

### Fixed

- A small passage-count difference after an interrupted note update no longer
  causes the entire collection to be recreated on the next Obsidian restart.
- Note updates are now journalled before ZVec storage is changed. If Obsidian
  closes during an update, only that note is recovered after restart.
- Compatible non-empty indexes remain searchable while interrupted work is
  repaired incrementally. Missing, empty, and incompatible indexes still
  rebuild automatically.

### Verification

- Consecutive restarts against a 12,986-passage test vault became searchable
  in approximately ten seconds and five seconds respectively.
- A changed note was recovered in the background without disturbing active
  results. The following unchanged restart performed no indexing or
  optimisation.

## 0.2.7 — 2026-07-30

### Fixed

- Obsidian restarts now reuse a healthy saved index immediately instead of
  making search wait for a foreground vault reconciliation.
- One-millisecond filesystem timestamp rounding no longer causes unchanged
  notes to be embedded again during a safety scan. Event-driven note updates
  still use exact timestamps.
- A saved index whose metadata and ZVec passage count disagree is detected and
  rebuilt instead of being treated as ready.

### Changed

- The startup safety reconciliation begins quietly after a 30-second delay.
  It remains incremental and does not replace the search status or redraw
  existing results.
- New installations and incompatible, incomplete, or missing indexes still
  build immediately so an unsafe partial index is never presented as current.

## 0.2.6 — 2026-07-28

### Changed

- Renamed the project and GitHub repository to **ZVec Hybrid Search for
  Obsidian** and `conoro/obsidian-zvec-hybrid-search` so its purpose is clear
  outside Obsidian.
- Runtime downloads now use the renamed repository as their canonical source.
- Existing installations, BRAT entries, release links, and clones using the
  previous repository path continue to work through GitHub redirects.

### Compatibility

- The in-app name remains **ZVec Hybrid Search**, and the plugin ID remains
  `zvec-hybrid-search`, preserving updates and user settings for existing
  installations.

## 0.2.5 — 2026-07-28

### Changed

- Runtime release validation now accepts both the current repository path and
  the planned `conoro/obsidian-zvec-hybrid-search` path.
- URL validation remains restricted to the two exact repository names,
  matching release version, and matching runtime asset name.

### Migration

- This compatibility release keeps existing BRAT installations and fresh
  runtime downloads working while the GitHub repository is renamed.

## 0.2.4 — 2026-07-27

### Fixed

- Every Markdown heading now starts a searchable passage, including later
  headings in short notes and headings without body text.
- Search results now open at the correct heading line when a note contains
  frontmatter.
- Index recreation is awaited before a schema migration begins writing the
  replacement index.

### Changed

- The index schema is upgraded once so existing notes are rebuilt with
  heading-aware passages. Normal incremental indexing resumes afterward.

## 0.2.3 — 2026-07-27

### Fixed

- Added a Load more button so every ranked match can be reached when the total
  exceeds the initial result batch.
- Search summaries now distinguish the total match count from the number
  currently shown.
- Corrected the automatic-indexing setting description to the current
  10-second quiet period.

### Changed

- The existing result-count setting now controls the initial and subsequent
  batch size. Additional batches append without rerunning search or replacing
  cards already on screen.

## 0.2.2 — 2026-07-27

### Fixed

- Added a Clear button that removes the query and results and cancels any
  in-flight search display.
- Editing or deleting a completed query now removes stale results immediately.
- Automatic incremental indexing no longer redraws or shifts the result list.

### Changed

- Increased the note-change quiet period from 1.2 seconds to 10 seconds so
  continuous editing is indexed as one efficient background update.

## 0.2.1 — 2026-07-27

### Changed

- Removed unused CUDA and TensorRT provider libraries from the Linux x64
  runtime. Semantic search uses ONNX CPU inference, so these files added more
  than 300 MB without being usable by the plugin.
- Strengthened release smoke tests from module loading to an actual ONNX CPU
  inference on every target.
- Removed compile-time TypeScript declarations from runtime archives.

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

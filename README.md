# ZVec Hybrid Search

ZVec Hybrid Search adds a fast local search sidebar to Obsidian. It combines
ZVec BM25 full-text search with semantic similarity so results can match both
the words you typed and the meaning behind them.

> [!IMPORTANT]
> Version 0.1.1 is an early developer preview. It is not yet available in the
> Obsidian Community Plugin directory and is not currently compatible with
> BRAT. The manual installation below requires Node.js 22 or newer.

## Why use it?

ZVec Hybrid Search provides:

- Hybrid, keyword-only, and semantic-only search.
- All-term, any-term, and exact-phrase matching.
- Sorting by relevance, modified date, created date, or title.
- Best-passage-per-note or all-passage result grouping.
- Heading-aware previews and highlighted matches.
- Automatic updates when notes are created, edited, renamed, or deleted.
- Whole-vault or selected top-level folder indexing.
- Vault-relative exclusion patterns.

## Current compatibility

- Obsidian desktop 1.8.0 or newer.
- Currently validated on macOS with Apple silicon.
- Node.js 22 or newer and npm are required for this preview.
- Mobile is not supported because ZVec uses native desktop libraries.

Windows and Linux are targets for the Community Plugin release, but their
packaged installers have not yet been validated.

## Install the preview

Back up your vault before installing any pre-release plugin.

1. Install [Node.js 22 or newer](https://nodejs.org/).
2. Open a terminal and run:

   ```bash
   git clone https://github.com/conoro/zvec-hybrid-search.git
   cd zvec-hybrid-search
   npm install
   npm run verify
   npm run install:local -- --vault "/path/to/your/Vault"
   ```

3. In Obsidian, open **Settings → Community plugins**.
4. Enable **ZVec Hybrid Search**.
5. Open it from the ribbon or run **Open hybrid search** from the command
   palette.

The first semantic index downloads the selected MiniLM model and may take
several minutes. Later launches use the cached model and update only changed
notes.

To update this preview:

```bash
git pull
npm install
npm run verify
npm run install:local -- --vault "/path/to/your/Vault"
```

## Search

Type a query and press **Enter**. Search options are collapsed by default:

- **Hybrid** combines ZVec BM25 keyword results with semantic similarity.
- **Keywords** uses ZVec full-text search without semantic ranking.
- **Semantic** finds passages with similar meaning through local MiniLM
  embeddings.
- **All terms (AND)** requires every query term and is the default.
- **Any term (OR)** allows results containing only some terms.
- **Exact phrase** searches for the phrase as written.

Select a result to open the note at the matching passage.

## Index settings

Open **Settings → ZVec Hybrid Search** to configure:

- The entire vault or selected top-level folders.
- Excluded vault-relative paths such as `.trash/**` or `Archive/**`.
- Automatic incremental indexing.
- Default search mode, matching, sorting, and grouping.
- Passage size, overlap, embedding backend, and title boost.

Changing folder scope, exclusions, passage settings, or the embedding model
requires **Save and rebuild**.

## Background activity and battery use

Normal index maintenance is event-driven. Note events are coalesced for 1.2
seconds, small batches are optimized after 45 idle seconds, and an hourly
metadata reconciliation catches missed external changes.

The ZVec and embedding processes sleep when idle. The embedding process exits
after 10 minutes without work and restarts automatically. There is no
continuous polling, companion server, daemon, container, or Python service.

## Privacy and network use

- Note text, embeddings, index files, and settings remain on the local
  machine.
- The plugin has no telemetry or analytics.
- The only expected network access is the first download of the selected
  MiniLM model from Hugging Face.
- Search and indexing do not send vault content to an API.

ZVec provides the local BM25 and vector database. MiniLM converts note text
into vectors used for semantic search.

## Removing the preview

Disable the plugin in Obsidian, then remove the
`.obsidian/plugins/zvec-hybrid-search` folder from the vault. This removes the
local index and cached model stored with that plugin installation; it does not
modify or delete notes.

## Bugs and security

Open a [GitHub issue](https://github.com/conoro/zvec-hybrid-search/issues) for
ordinary bugs. Do not attach private notes, vault paths, model caches, or index
files. Security issues should use GitHub's private vulnerability reporting as
described in [SECURITY.md](SECURITY.md).

Release history is in [CHANGELOG.md](CHANGELOG.md). Source-build and
contribution details are in [DEVELOPMENT.md](DEVELOPMENT.md).

## License

MIT. See [LICENSE](LICENSE).

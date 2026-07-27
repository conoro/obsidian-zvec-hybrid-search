# ZVec Hybrid Search

ZVec Hybrid Search adds a fast local search sidebar to Obsidian. It combines
ZVec BM25 full-text search with semantic similarity so results can match both
the words you typed and the meaning behind them.

> [!IMPORTANT]
> Version 0.2.4 is a public beta. It is not yet listed in the Obsidian
> Community Plugin directory. No Node.js, server, terminal command, container,
> or Python installation is required.

## Why use it?

ZVec Hybrid Search provides:

- Hybrid, keyword-only, and semantic-only search.
- All-term, any-term, and exact-phrase matching.
- Sorting by relevance, modified date, created date, or title.
- Best-passage-per-note or all-passage result grouping.
- Independently searchable heading sections with accurate heading navigation.
- Automatic updates when notes are created, edited, renamed, or deleted.
- Whole-vault or selected top-level folder indexing.
- Vault-relative exclusion patterns.

## Current compatibility

- Obsidian desktop 1.8.0 or newer.
- macOS with Apple silicon.
- Windows x64.
- Linux x64 or ARM64.
- Mobile is not supported because ZVec uses native desktop libraries.

## Install the beta

Back up your vault before installing any pre-release plugin.

### With BRAT (recommended)

BRAT installs the plugin directly from this GitHub repository and can keep it
updated. This is still a GitHub beta installation; it does not mean the plugin
has been submitted to or accepted into Obsidian's Community Plugin directory.

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Install and enable **BRAT**.
3. Open **Settings → BRAT** and select **Add beta plugin**.
4. Paste `https://github.com/conoro/zvec-hybrid-search`.
5. Select **Latest version**, leave **Enable after installing the plugin**
   enabled, and select **Add plugin**.
6. Open ZVec Hybrid Search from the ribbon or run **Open hybrid search** from
   the command palette.

No GitHub token is needed for this public repository. To update later, open
**Settings → BRAT** and use **Check and update plugin**. BRAT can also check
for updates when Obsidian starts if you enable that option in its settings.

### Manual installation

1. Download `zvec-hybrid-search-0.2.4.zip` from the
   [0.2.4 GitHub release](https://github.com/conoro/zvec-hybrid-search/releases/tag/0.2.4).
2. Extract it into this folder inside your vault:
   `.obsidian/plugins/zvec-hybrid-search/`
3. Confirm that the folder contains `main.js`, `manifest.json`, and
   `styles.css` directly, rather than inside another nested folder.
4. Restart Obsidian.
5. Open **Settings → Community plugins** and enable
   **ZVec Hybrid Search**.
6. Open it from the ribbon or run **Open hybrid search** from the command
   palette.

On first use, the plugin automatically downloads the matching private runtime
from the same GitHub release and verifies its SHA-256 digest before installing
it. This is roughly 75–100 MB depending on platform. The first semantic index
then downloads the selected MiniLM model and may take several minutes. Later
launches reuse both downloads and update only changed notes.

Version 0.2.4 rebuilds an older index once so headings from every section
become independently searchable. Later launches return to incremental updates.

For a manual update, disable the plugin, replace `main.js`, `manifest.json`,
and `styles.css` with the files from the newer release, restart Obsidian, and
enable it again. Your index and cached model remain in place.

## Search

Type a query and press **Enter**. Use **Clear** or press **Escape** to remove
the query and its results. Editing a completed query also removes its stale
results immediately. Larger result sets are shown in configurable batches;
use **Load more** to append the next batch without rerunning the search.
Search options are collapsed by default:

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

Normal index maintenance is event-driven. Note events are coalesced until
editing has been quiet for 10 seconds, small batches are optimized after 45
idle seconds, and an hourly metadata reconciliation catches missed external
changes. Automatic incremental updates do not redraw the search results.

The ZVec and embedding processes sleep when idle. The embedding process exits
after 10 minutes without work and restarts automatically. There is no
continuous polling, companion server, daemon, container, or Python service.

## Privacy and network use

- Note text, embeddings, index files, and settings remain on the local
  machine.
- The plugin has no telemetry or analytics.
- The first use downloads the platform runtime from this project's GitHub
  release. GitHub's published SHA-256 digest is verified before extraction.
- The first semantic index downloads the selected MiniLM model from Hugging
  Face.
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

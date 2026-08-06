# ZVec Hybrid Search for Obsidian

ZVec Hybrid Search helps you find notes using exact words, related terms, or
similar ideas. Search runs locally, the index updates automatically, and there
is no separate server or command-line setup.

## What it does

- Finds notes using words, meaning, or a combination of both.
- Searches note titles, headings, content, tags, and YAML front-matter
  properties such as web-clipping authors, descriptions, sources, and dates.
- Opens each result at the matching section of the note.
- Updates the index when notes are created, edited, renamed, or deleted.
- Lets you index the whole vault or selected top-level folders.
- Lets you exclude folders that you do not want to search.
- Sorts results by relevance, date, or title.
- Keeps note text and the search index on your computer.
- Stores generated search data outside the vault, avoiding sync conflicts with
  Dropbox, iCloud, OneDrive, and similar services.

## Requirements

- Obsidian desktop 1.8.0 or newer.
- macOS with Apple silicon.
- Windows x64.
- Linux x64 or ARM64.

Mobile is not supported.

## Install

Once the plugin is available in the Community Plugin directory:

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **ZVec Hybrid Search**.
3. Select **Install**, then **Enable**.

If the Community Plugin listing is not available yet, install the public beta
with BRAT.

### Install the public beta with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs the plugin from
GitHub and can keep it updated. BRAT installation is separate from Obsidian's
Community Plugin directory.

Back up your vault before installing any beta plugin.

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Install and enable **BRAT**.
3. Open **Settings → BRAT** and select **Add beta plugin**.
4. Paste `https://github.com/conoro/obsidian-zvec-hybrid-search`.
5. Select **Latest version**.
6. Leave **Enable after installing the plugin** selected and choose
   **Add plugin**.

No GitHub account or token is required.

To update later, open **Settings → BRAT** and use **Check and update plugin**.
BRAT can also check for updates when Obsidian starts.

## What happens after installation

When the plugin is first enabled, it prepares everything automatically:

1. It downloads the private local search runtime for your computer. The
   download is about 75–100 MB, depending on the operating system.
2. It downloads the recommended language model used to find notes with similar
   meanings.
3. It builds the first search index.

An internet connection is needed for the two initial downloads. Your notes are
not uploaded.

Open **ZVec Hybrid Search** from the ribbon or run **Open hybrid search** from
the command palette. The sidebar shows its progress. You can search when its
status changes to **Ready**.

The first index can take several minutes for a large vault. Later starts reuse
the local index immediately and update only notes that have changed.

## Search your vault

1. Open the ZVec Hybrid Search sidebar.
2. Type a query and press **Enter** or select **Search**.
3. Select a result to open the note at the matching section.

Use **Load more** when there are more results than the current batch. Use
**Clear**, or press **Escape**, to remove the current query and results.
Changing a completed query clears its old results immediately.

### Search options

Search options are collapsed by default. The defaults suit most searches.

- **Hybrid** is the recommended mode. It considers both the words in the query
  and passages with a similar meaning.
- **Keywords** searches for the words in the query.
- **Semantic** searches by meaning. Term matching options do not apply in this
  mode.

In Hybrid and Keywords modes, term matching controls how query words are
handled:

- **All terms** requires every term and is the default.
- **Any term** allows results containing only some terms.
- **Exact phrase** searches for the phrase as written.

You can also limit results by the note's modified date. **Modified from** and
**Modified to** can be used together or independently; leave both blank to
search all dates. The To date includes the whole selected day.

Sort order and whether to show the best matching section from each note or
every matching section are selectable too.

YAML property names and values are searchable even when they do not appear in
the note body. Metadata matches appear as a **Properties** result.

## Settings

Open **Settings → ZVec Hybrid Search**.

The most useful settings are:

- **Included notes:** Index the entire vault or selected top-level folders.
- **Excluded paths:** Skip folders using patterns such as `.trash/**` or
  `Archive/**`.
- **Automatic incremental indexing:** Keep the index updated as notes change.
- **Search defaults:** Choose the initial search mode, term matching, sort
  order, and result grouping.
- **Results per batch:** Choose how many results appear at a time.

The default settings are suitable for most vaults. The settings under
**Local indexing**, including the embedding backend and passage controls, are
intended for advanced tuning.

Changing the folder scope, excluded paths, passage controls, or embedding
backend requires **Save and rebuild**.

## Privacy, downloads, and local storage

- Note text, the search index, settings, and the language model remain on your
  computer. Search and indexing do not send vault content to an online
  service.
- The plugin has no telemetry or analytics.
- On first use, the plugin contacts GitHub to download the correct private
  Node.js runtime for the computer. This runtime contains ZVec and the local
  embedding software. The download is verified before it is installed.
- The recommended language model is downloaded from Hugging Face on first use.
- The runtime, model, index, and index state are stored in the operating
  system's local application-data folder, outside the vault. This keeps the
  native database away from Dropbox, iCloud, OneDrive, and similar vault sync
  services.
- The local runtime runs in child processes so a search or indexing failure can
  be contained without bringing down Obsidian.

[ZVec](https://github.com/alibaba/zvec) provides the local keyword and
similarity search database.
[Transformers.js](https://github.com/huggingface/transformers.js) runs the
[MiniLM model](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX)
locally to convert note content into vectors that can be compared by meaning.

## Troubleshooting

### The sidebar does not reach Ready

- Confirm that the computer is online for the initial downloads.
- Confirm that the drive containing the vault is connected and available.
- Wait a minute, then run the search again.
- If the problem continues, disable and re-enable the plugin in
  **Settings → Community plugins**.

Download, storage, and indexing errors are contained within the plugin and do
not modify your notes.

### A recently edited note is missing

Automatic indexing waits until editing has been quiet for about 10 seconds. If
the note is still missing, open **Settings → ZVec Hybrid Search** and select
**Incremental reindex**.

### The wrong folders are being searched

Open **Settings → ZVec Hybrid Search**, change **Included notes** or
**Excluded paths**, then select **Save and rebuild**.

## Manual installation

Use this method if you do not want to use BRAT.

1. Open the
   [GitHub releases page](https://github.com/conoro/obsidian-zvec-hybrid-search/releases),
   choose the newest version, and download `zvec-hybrid-search-<version>.zip`.
2. Extract it into `.obsidian/plugins/zvec-hybrid-search/` inside the vault.
3. Confirm that `main.js`, `manifest.json`, and `styles.css` are directly
   inside that folder.
4. Restart Obsidian.
5. Open **Settings → Community plugins** and enable
   **ZVec Hybrid Search**.

For a manual update, disable the plugin and replace those three files with the
ones from the newer release. Restart Obsidian and enable the plugin again. The
existing index and downloaded model are retained.

## Uninstalling

Disable the plugin in Obsidian, then remove the
`.obsidian/plugins/zvec-hybrid-search` folder from the vault. Your notes are not
changed or deleted.

Generated search data is kept separately so reinstalling does not require
another full index. To remove it as well, delete the vault's opaque folder
inside:

- macOS: `~/Library/Application Support/zvec-hybrid-search/vaults/`
- Windows: `%LOCALAPPDATA%\zvec-hybrid-search\vaults\`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/zvec-hybrid-search/vaults/`

If there is more than one folder there, remove only the one belonging to the
uninstalled vault. It is safe to leave these generated files in place.

## Support and security

Open a
[GitHub issue](https://github.com/conoro/obsidian-zvec-hybrid-search/issues)
for ordinary bugs. Do not attach private notes, vault paths, model caches, or
index files.

Report security issues through GitHub's private vulnerability reporting as
described in [SECURITY.md](SECURITY.md).

Release history is in [CHANGELOG.md](CHANGELOG.md). Source-build and
contribution details are in [DEVELOPMENT.md](DEVELOPMENT.md).

## License

MIT. See [LICENSE](LICENSE).

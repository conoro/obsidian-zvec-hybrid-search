# ZVec Hybrid Search for Obsidian

ZVec Hybrid Search helps you find notes using exact words, related terms, or
similar ideas. Search runs locally, the index updates automatically, and there
is no separate server or command-line setup.

Inside Obsidian, the plugin is shown as **ZVec Hybrid Search**.

> [!IMPORTANT]
> Version 0.2.6 is a public beta. It is not yet available in Obsidian's
> Community Plugin directory.

## What it does

- Finds notes using words, meaning, or a combination of both.
- Searches note titles, headings, and content.
- Opens each result at the matching section of the note.
- Updates the index when notes are created, edited, renamed, or deleted.
- Lets you index the whole vault or selected top-level folders.
- Lets you exclude folders that you do not want to search.
- Sorts results by relevance, date, or title.
- Keeps note text and the search index on your computer.

## Requirements

- Obsidian desktop 1.8.0 or newer.
- macOS with Apple silicon.
- Windows x64.
- Linux x64 or ARM64.

Mobile is not supported.

## Install with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs the plugin from
GitHub and can keep it updated. This remains a beta installation and is
separate from Obsidian's Community Plugin directory.

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

1. It downloads the local search component for your computer. The download is
   about 75–100 MB, depending on the operating system.
2. It downloads the recommended language model used to find notes with similar
   meanings.
3. It builds the first search index.

An internet connection is needed for the two initial downloads. Your notes are
not uploaded.

Open **ZVec Hybrid Search** from the ribbon or run **Open hybrid search** from
the command palette. The sidebar shows its progress. You can search when its
status changes to **Ready**.

The first index can take several minutes for a large vault. Later starts reuse
the downloads and update only notes that have changed.

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

You can also change the sort order and choose whether to show the best matching
section from each note or every matching section.

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

## Privacy and downloads

- Note text, the search index, settings, and the language model remain on your
  computer.
- Search and indexing do not send vault content to an online service.
- The plugin has no telemetry or analytics.
- The first installation downloads the local search component from this
  project's GitHub release.
- The recommended language model is downloaded from Hugging Face.

[ZVec](https://github.com/alibaba/zvec) provides the local keyword and
similarity search database. MiniLM converts note content into a form that can
be compared by meaning.

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

1. Download `zvec-hybrid-search-0.2.6.zip` from the
   [0.2.6 GitHub release](https://github.com/conoro/obsidian-zvec-hybrid-search/releases/tag/0.2.6).
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
`.obsidian/plugins/zvec-hybrid-search` folder from the vault. This also removes
the local search index and downloaded model. Your notes are not changed or
deleted.

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

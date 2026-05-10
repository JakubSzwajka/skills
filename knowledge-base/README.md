# Knowledge Base

Two skills that work against the Obsidian-backed knowledge graph at `~/knowledge/`.

- **`kb/`** — query and create knowledge nodes. Wraps `kb.py` (search, get, links, graph, list, tags, create, lint). Use when you need to recall a concept, follow links, or add a new durable node.
- **`kb-compile/`** — turn raw material in `~/knowledge/inbox/` into durable nodes in `~/knowledge/knowledge/` and archive the source into `~/knowledge/sources/`. Use when new material has been dropped into the inbox and is ready to be processed.

Rule of thumb: `kb` is the read/write interface for an existing graph; `kb-compile` is the ingestion pipeline that feeds it.

`kb` is the **only** sanctioned interface to the graph — do not Grep/Glob/Bash directly into `~/knowledge/knowledge/`.

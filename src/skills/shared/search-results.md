## Search Result Shape

Each result from `watcher_search` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Qdrant point ID |
| `score` | number | Similarity score (0-1, higher = more relevant) |
| `payload.file_path` | string | Source file path |
| `payload.chunk_text` | string | The matched text chunk |
| `payload.chunk_index` | number | Chunk position within the file |
| `payload.total_chunks` | number | Total chunks for this file |
| `payload.content_hash` | string | Hash of the full document content |
| `payload.matched_rules` | string[] | Names of inference rules that matched |

Additional metadata fields depend on the deployment's inference rules (e.g., `domain`, `status`, `author`). Use `watcher_query` to discover available fields.

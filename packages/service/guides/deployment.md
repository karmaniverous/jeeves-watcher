---
title: Deployment Guide
---

# Deployment Guide

Production deployment recommendations for `jeeves-watcher`.

---

## Prerequisites

### Node.js

**Version:** Node.js 22.13+ (Node.js 24+ recommended). Enrichment metadata is stored with Node's built-in `node:sqlite` module, so installation needs no native build tools.

**Installation:**

- **Windows:** Download from [nodejs.org](https://nodejs.org/)
- **Linux:** Use nvm or distribution package manager
- **macOS:** Use nvm or Homebrew

**Verify:**

```bash
node --version  # Should be v22.13.0 or higher
```

### Git (Optional — for VCS)

**Version:** Git 2.x+

Git is required only if you enable the VCS subsystem (`vcs.enabled: true`). Without git, the watcher operates normally — VCS features are gracefully disabled.

**Verify:**

```bash
git --version  # Should be v2.x.x or higher
```

### Qdrant

**Required:** Qdrant must be accessible before starting the watcher (the collection is created or checked at startup).

---

## Qdrant Setup

### Option 1: Windows (Native Binary)

**Download:**

1. Go to [Qdrant Releases](https://github.com/qdrant/qdrant/releases)
2. Download the latest Windows x86_64 binary (e.g., `qdrant-x86_64-pc-windows-msvc.zip`)
3. Extract to a permanent location (e.g., `C:\qdrant\`)

**Run directly:**

```powershell
cd C:\qdrant
.\qdrant.exe
```

**Default settings:**

- **Port:** 6333
- **Data:** `./storage/` (relative to binary location)
- **Dashboard:** `http://localhost:6333/dashboard`

**Install as service (NSSM):**

```powershell
# Install NSSM if not already installed
# Download from https://nssm.cc/download

nssm install qdrant "C:\qdrant\qdrant.exe"
nssm set qdrant AppDirectory "C:\qdrant"
nssm set qdrant Start SERVICE_AUTO_START
nssm start qdrant
```

**Verify:**

```bash
curl http://localhost:6333/healthz
```

Output:

```text
healthz check passed
```

### Option 2: Linux (Native Binary)

**Download:**

```bash
wget https://github.com/qdrant/qdrant/releases/download/v1.x.x/qdrant-x86_64-unknown-linux-musl.tar.gz
tar -xzf qdrant-x86_64-unknown-linux-musl.tar.gz
sudo mv qdrant /usr/local/bin/
```

**Run directly:**

```bash
qdrant
```

**Install as systemd service:**

Create `/etc/systemd/system/qdrant.service`:

```ini
[Unit]
Description=Qdrant Vector Search Engine
After=network.target

[Service]
Type=simple
User=qdrant
Group=qdrant
WorkingDirectory=/var/lib/qdrant
ExecStart=/usr/local/bin/qdrant
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**Setup:**

```bash
# Create user and data directory
sudo useradd -r -s /bin/false qdrant
sudo mkdir -p /var/lib/qdrant
sudo chown qdrant:qdrant /var/lib/qdrant

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now qdrant
```

**Verify:**

```bash
curl http://localhost:6333/healthz
```

### Option 3: Docker

**Run Qdrant in a container:**

```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

**Persistent storage:** The `-v` flag mounts a local directory for data persistence.

**Verify:**

```bash
curl http://localhost:6333/healthz
```

### Qdrant Configuration

**Config file:** `config/config.yaml` (relative to Qdrant binary or Docker mount)

**Common settings:**

```yaml
service:
  host: 0.0.0.0 # Bind address (use 127.0.0.1 to restrict to localhost)
  http_port: 6333 # HTTP API port
  grpc_port: 6334 # gRPC port

storage:
  storage_path: ./storage # Data directory

telemetry_disabled: true # Disable telemetry
```

For production, consider:

- **Snapshots:** Enable automatic snapshots for backups
- **Resource limits:** Set memory limits in `config.yaml`
- **Authentication:** Enable API key authentication for remote access (and set `vectorStore.apiKey` in the watcher config)

See [Qdrant Documentation](https://qdrant.tech/documentation/) for full configuration options.

---

## Watcher Installation

### Global Install (Recommended for Services)

```bash
npm install -g @karmaniverous/jeeves-watcher
```

**Verify:**

```bash
jeeves-watcher --version
```

### Project Install (Development)

```bash
npm install --save-dev @karmaniverous/jeeves-watcher
```

**Run via npx:**

```bash
npx jeeves-watcher start --config ./config.json
```

---

## Configuration

### Initialize Config

```bash
jeeves-watcher init --output /etc/jeeves-watcher
```

`--output` (`-o`) names a directory; the command writes `<dir>/config.json` from the default template and leaves an existing file untouched.

### Edit Config

Key settings for production:

```json
{
  "watch": {
    "paths": [
      "/data/documents/**/*.{md,txt,pdf,docx}",
      "/data/archives/**/*.json"
    ],
    "ignored": ["**/node_modules/**", "**/.git/**"],
    "debounceMs": 2000,
    "stabilityThresholdMs": 500
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}",
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "dimensions": 3072,
    "rateLimitPerMinute": 300,
    "concurrency": 5
  },
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "production_docs"
  },
  "stateDir": "/var/lib/jeeves-watcher",
  "api": {
    "host": "127.0.0.1",
    "port": 1936
  },
  "logging": {
    "level": "info",
    "file": "/var/log/jeeves-watcher/watcher.log"
  },
  "shutdownTimeoutMs": 30000
}
```

**State directory:** `stateDir` (default `.jeeves-metadata`) holds the enrichment store (`enrichments.sqlite`), the issues file (`issues.json`) and the values index (`values.v8`). A relative path resolves against the service's working directory, which a service manager may set somewhere unexpected, so use an absolute path for services. With VCS enabled, `stateDir` must not overlap any watch path.

### Environment Variables

**Set API keys:** Config values can reference environment variables as `${VAR}` (the example above reads the Gemini key from `GOOGLE_API_KEY`). A variable that is not set is left as the literal `${VAR}` text, so make sure the service's environment defines it. For `api.apiKey` and source callback URLs and headers, an unresolved reference stops the service at startup.

```bash
# Windows (PowerShell)
$env:GOOGLE_API_KEY = "your-key-here"

# Linux/macOS
export GOOGLE_API_KEY="your-key-here"
```

**CLI API key:** When `api.apiKey` is set, the API-calling CLI commands (and the OpenClaw plugin) send the key from `--api-key` or the `JEEVES_WATCHER_API_KEY` environment variable; they do not read the service config.

```bash
export JEEVES_WATCHER_API_KEY="your-watcher-api-key"
```

For services, see [Service environment](#service-environment) below.

### Validate Config

```bash
jeeves-watcher config validate -c /path/to/config.json
```

Validates the file against the config schema (prints `Config is valid.` or the validation error). A running service can also validate a candidate config with `POST /config/validate`.

---

## Running as a Service

`jeeves-watcher service install` registers the service with the platform's service manager. The service runs `node <package>/dist/cli/jeeves-watcher/index.js start -c <config>`; pass `-c` with an absolute config path. The default service name is `jeeves-watcher` (override with `-n <name>` on every `service` subcommand).

```bash
jeeves-watcher service install -c /etc/jeeves-watcher/config.json
jeeves-watcher service start
jeeves-watcher service status
jeeves-watcher service stop
jeeves-watcher service restart
jeeves-watcher service uninstall
```

### Windows (NSSM)

**Install NSSM:** Download from [nssm.cc](https://nssm.cc/download) and put `nssm.exe` on the `PATH`. Run the commands from an elevated shell.

`service install` runs `nssm install` with the start command above, sends stdout and stderr to `%USERPROFILE%\jeeves-watcher.log`, and turns on NSSM log rotation (1 MiB). It does not set a working directory or environment variables. `service start|stop|restart|uninstall` call `nssm start|stop|restart|remove`.

```powershell
jeeves-watcher service install -c C:\jeeves\watcher\config.json
nssm set jeeves-watcher AppDirectory "C:\jeeves\watcher"
nssm set jeeves-watcher Start SERVICE_AUTO_START
nssm set jeeves-watcher AppEnvironmentExtra "GOOGLE_API_KEY=your-key-here" "TZ=UTC"
jeeves-watcher service start
```

### Linux (systemd)

`service install` writes a user unit at `~/.config/systemd/user/jeeves-watcher.service` and enables it (`systemctl --user daemon-reload`, `systemctl --user enable`); start it with `service start`. The unit runs the start command with `Restart=on-failure` and `RestartSec=5`; systemd must be able to find `node` (edit `ExecStart` to the absolute `node` path if Node is installed via nvm). A user bus is required.

If a system unit `jeeves-watcher.service` already exists (provisioned outside the watcher), `service install` does nothing and reports it; `start|stop|restart|status` manage the system unit and `uninstall` refuses to remove it.

```bash
jeeves-watcher service install -c /etc/jeeves-watcher/config.json
systemctl --user edit jeeves-watcher   # add the [Service] Environment= lines below
jeeves-watcher service start
loginctl enable-linger "$USER"         # keep user services running after logout
```

**View logs** (stdout goes to the journal unless `logging.file` is set):

```bash
journalctl --user -u jeeves-watcher -f
```

### macOS (launchd)

`service install` writes `~/Library/LaunchAgents/jeeves-watcher.plist` (`RunAtLoad`, `KeepAlive`), with stdout and stderr in `~/Library/Logs/jeeves-watcher.log`. `service start` and `service stop` run `launchctl load` and `launchctl unload` on the plist.

### Service environment

The service does not inherit your shell's environment. Define every variable the config references (and `TZ=UTC`, see [Source Documents](#source-documents)) in the service definition:

- **Windows (NSSM):** `nssm set jeeves-watcher AppEnvironmentExtra "GOOGLE_API_KEY=your-key-here" "TZ=UTC"`
- **Linux (systemd):** `systemctl --user edit jeeves-watcher`, then:

  ```ini
  [Service]
  Environment="GOOGLE_API_KEY=your-key-here"
  Environment="TZ=UTC"
  ```

- **macOS (launchd):** add an `EnvironmentVariables` dictionary to the plist, then `jeeves-watcher service restart`

---

## Resource Profile

### Memory

| State | Memory Usage |
| --- | --- |
| **Idle** (no events) | ~50–100MB |
| **Processing single file** | +5–20MB (document text in memory) |
| **Burst processing** | Bounded by `embedding.concurrency` × avg document size |

**Recommendation:** 512MB minimum, 1GB comfortable for moderate workloads.

### CPU

**I/O-wait dominated** — most time is spent waiting for embedding API responses.

| State                   | CPU Usage                      |
| ----------------------- | ------------------------------ |
| **Idle**                | ~0%                            |
| **File extraction**     | Brief spike (PDF/DOCX parsing) |
| **Embedding API waits** | ~0% (blocking I/O)             |

**Recommendation:** 1 CPU core sufficient for most workloads.

### Disk

**Data:**

- **State directory:** the enrichment store (`enrichments.sqlite`, roughly the size of the enrichment JSON), plus `issues.json` and `values.v8`
- **Logs:** Depends on `logging.level` and rotation policy

**Qdrant storage:**

- ~100MB per million 768-dim vectors (varies by compression)

**Recommendation:** 10GB minimum for moderate document corpora.

### Network

**Embedding API traffic:**

- Average: ~1–2KB per embedding request (text payload)
- Burst: Up to `embedding.concurrency` concurrent requests

**Qdrant traffic:**

- Upsert: ~3KB per point (vector + payload)
- Search: ~1KB request, ~5KB response (varies by limit)

**Recommendation:** 10 Mbps sufficient for most workloads.

---

## Co-location Recommendations

The watcher is designed to co-locate with other services on a single machine.

### Typical Stack

| Service            | Port   | Memory    | CPU     | Role                  |
| ------------------ | ------ | --------- | ------- | --------------------- |
| **Qdrant**         | 6333   | 200MB–2GB | ~0%     | Vector store          |
| **jeeves-watcher** | 1936   | 100MB–1GB | ~5%     | Indexing + search API |
| **jeeves-server**  | 1934   | 50MB      | ~1%     | File browser + web UI |
| **n8n**            | 5678   | 500MB–2GB | 10–50%  | Workflow automation   |
| **OpenClaw**       | varies | 2–8GB     | 50–100% | LLM inference         |

**Total:** ~8–16GB RAM, 4 CPU cores recommended.

**Contention:**

- **Embedding API:** The watcher's requests are bounded by `embedding.rateLimitPerMinute`; other services using the same provider account share its quota
- **Qdrant:** Watcher writes, n8n/jeeves-server read (native concurrent access)
- **Disk I/O:** All services write logs; stagger heavy operations

---

## Initial Indexing

### Estimate Time and Cost

| Corpus Size | Time (`concurrency` 5, `rateLimitPerMinute` 1000) | Gemini Cost ($0.15/1M tokens) |
| --- | --- | --- |
| 1,000 files | ~1 minute | ~$0.03 |
| 10,000 files | ~10 minutes | ~$0.30 |
| 100,000 files | ~100 minutes | ~$3.00 |

**Assumptions:** Average 500 tokens per document, one embedding request per document. Documents longer than `chunkSize` (default 1000 characters) are split into several chunks, embedded up to 100 chunks per request. The default `rateLimitPerMinute` is 300.

**Schedule:** For large corpora, run initial indexing during off-hours to avoid rate limit contention.

### Run Initial Indexing

```bash
# Start watcher (performs initial scan automatically)
jeeves-watcher start --config /path/to/config.json
```

Or manually trigger a full reindex of a running service:

```bash
jeeves-watcher reindex --scope full --port 1936
```

(Without `--scope`, the CLI runs a `rules` reindex, which only re-applies rules to points that already exist.)

**Monitor progress:** Check logs for `File processed successfully` entries, and `GET /status` for `health.initialScan` and `health.reindex`.

---

## Monitoring

### Health Checks

**HTTP endpoint** (never requires the API key):

```bash
curl http://localhost:1936/status
```

Output:

```json
{
  "name": "watcher",
  "version": "0.20.0",
  "uptime": 86400,
  "status": "healthy",
  "health": {
    "collection": {
      "name": "production_docs",
      "pointCount": 152340,
      "dimensions": 3072
    },
    "reindex": { "active": false },
    "initialScan": {
      "active": false,
      "filesMatched": 12000,
      "filesEnqueued": 12000,
      "completedAt": "2026-02-20T08:15:00.000Z",
      "durationMs": 4200
    }
  }
}
```

`GET /status` answers `200` whenever the API server is up. When Qdrant cannot be read, `status` is `"degraded"` and `health` holds an `error` message instead. Responses are cached for `api.cacheTtlMs` (default 30 s). `jeeves-watcher status` prints the same response.

**Use in monitoring:** Poll `/status` every 60s. Alert on a non-200 response or a `status` other than `"healthy"`.

### Logs

**Structured JSON logging** via pino. Example log entry:

```json
{
  "level": 30,
  "time": 1708435200000,
  "pid": 4242,
  "hostname": "docs-host",
  "filePath": "/data/documents/readme.md",
  "chunks": 2,
  "msg": "File processed successfully"
}
```

pino writes numeric levels (`30` = info, `40` = warn, `50` = error). Output goes to stdout, or to `logging.file` when set.

**Parse with standard tools:** jq, Splunk, ELK stack, etc.

**Log rotation:** The watcher does not rotate `logging.file`; use external tools (logrotate on Linux, NSSM rotation for the service's stdout on Windows).

### Alerts

**Critical events to alert on:**

- `level` 50 (error) entries (e.g. `Failed to process file`, `Failed to reload config`)
- `/status` endpoint down, or not `"healthy"`, for >5 minutes
- Growth of the issue count in `GET /issues` (indicates persistent failures)

---

## Backup and Recovery

### Backup Strategy

**Qdrant:**

- Use Qdrant's built-in [snapshot feature](https://qdrant.tech/documentation/concepts/snapshots/)
- Automated snapshots to persistent storage
- Alternatively: copy `{qdrant_storage_path}` directory while Qdrant is stopped

**Enrichment store:**

- Back up `<stateDir>/enrichments.sqlite` (SQLite in WAL mode). Copy it together with its `-wal` and `-shm` files while the service is stopped, or take an online copy with SQLite's backup API (e.g. `sqlite3 enrichments.sqlite ".backup enrichments.bak"`)
- `issues.json` and `values.v8` in the same directory need no backup: an `issues` reindex regenerates issues and a `full` reindex rebuilds the values index

**Config:**

- Backup `config.json`
- Store in version control (git)

### Recovery

**Scenario 1: Qdrant data lost**

1. Restore Qdrant snapshot (if available)
2. OR run full reindex:

```bash
jeeves-watcher reindex --scope full --port 1936
```

This rebuilds Qdrant from the filesystem + enrichment store.

**Scenario 2: Enrichment store lost**

1. Rebuild from Qdrant:

```bash
jeeves-watcher rebuild-metadata --port 1936
```

This writes every non-reserved payload field of each file point (rule-derived fields included) to the enrichment store; source-document enrichment is not rebuilt.

**Scenario 3: Both lost**

1. Restore from backups
2. OR reindex from scratch (metadata enrichment is lost, but can be re-applied via API)

---

## Scaling Considerations

### Vertical Scaling

**When to scale up:**

- Large corpus (>100K documents)
- High embedding API throughput
- Frequent bulk operations

**Recommendations:**

- **CPU:** 2–4 cores (parallel chunk processing)
- **Memory:** 2–4GB (large document buffering)
- **Embedding concurrency:** Increase `embedding.concurrency` (bounded by API rate limits)

### Horizontal Scaling

**Current limitation:** Single-writer design (only one watcher instance per Qdrant collection and per `stateDir`).

---

## Security

### API Access

**Default:** Binds to `127.0.0.1` (localhost only).

**For remote access:**

1. Bind to `0.0.0.0` (all interfaces)
2. Set `api.apiKey` (v0.20.0+) so every route except `GET /status` requires `Authorization: Bearer <key>` (see [Authentication](./api-reference.md#authentication)), and/or add a reverse proxy with authentication (nginx, Caddy)
3. Use TLS/HTTPS (via the reverse proxy)
4. Restrict network access to the hosts that call the API

**Example nginx config:**

```nginx
location /watcher/ {
    proxy_pass http://127.0.0.1:1936/;
    proxy_set_header Host $host;
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### API Keys

**Store securely:**

- Use environment variables (not hardcoded in config)
- Use secret management (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate keys regularly

### Qdrant

**For production:**

- Enable Qdrant API key authentication
- Use TLS for Qdrant HTTP/gRPC
- Restrict network access (firewall rules)

---

## Source Documents

Operational notes for a watcher that indexes [source documents](./source-documents.md) (v0.20.0+):

- **Check the version first.** Versions before 0.20.0 silently ignore config keys they do not know, so a config using `sources`, `api.apiKey` or `vectorStore.payloadIndexes` would load on an older watcher and run without them (including an open API). Check `jeeves-watcher --version` reports 0.20.0 or later before deploying such a config.
- **Pin the timezone.** Template and `set` date helpers (`dateFormat`, and `toUnix` on date strings without an offset) use the host's local timezone. Run the service with `TZ=UTC` (systemd: `Environment=TZ=UTC`; NSSM: `AppEnvironmentExtra TZ=UTC`) so rendered text and metadata do not depend on the host.
- **Startup-only settings.** `api.apiKey`, `sources` and `vectorStore.payloadIndexes` are read at startup. A config reload does not apply them; restart the service.
- **Secrets.** Provide `api.apiKey` and source callback credentials through environment variables (`${VAR}`). If a referenced variable is unset, the service refuses to start and names the config path.
- **Callback availability.** Every notification triggers a callback, so the source endpoint must be reachable from the watcher host and fast. Outages do not lose data (points stay untouched and an issue is recorded); watch `GET /issues` for `source_unavailable` and re-run `POST /reindex {"scope": "issues"}` after recovery.
- **Shutdown.** Pending notifications are held in memory. On shutdown the config watcher stops and the API server closes (no new notifications); then the file event queue and after it the notify queue are each drained and stopped, every step bounded by `shutdownTimeoutMs`. Anything left is dropped, and the enrichment store is closed only if no run is still in flight. Re-notify or reindex (`issues` scope retries failed references, even ones never indexed) if that matters.
- **Embedding rate limits.** A provider pause (`Retry-After`) longer than the root `maxBackoffMs` fails embedding requests fast (indexing records `embedding_error`, search answers `503`) instead of retrying early; raise `maxBackoffMs` if your provider asks for long pauses and you prefer to wait.
- **Callback size.** Callback responses over 10 MiB fail with `source_unavailable`; keep records small or split them into several references.
- **Tenant filters.** If many users share one collection, index the tenant field with `isTenant: true` and add it to every search filter; the watcher does not enforce tenancy.

---

## Version Control (VCS)

To enable git-backed content versioning, add the `vcs` block to your config:

```json
{
  "vcs": {
    "enabled": true
  }
}
```

This initializes a git repository in each watch root and begins tracking file changes with debounced batch commits.

### Remote Push Setup

To push commit history to a remote repository (backup mirror):

```json
{
  "watch": {
    "paths": [
      {
        "path": "/data/documents/**/*.md",
        "vcs": {
          "remote": "https://github.com/org/docs-backup.git",
          "accessToken": "${GIT_ACCESS_TOKEN}"
        }
      }
    ]
  }
}
```

Set the access token as an environment variable:

```bash
# Linux/macOS
export GIT_ACCESS_TOKEN="ghp_your_token_here"

# Windows (PowerShell)
$env:GIT_ACCESS_TOKEN = "ghp_your_token_here"
```

For services, add the environment variable to the service definition (see [Service environment](#service-environment) above).

Push failures are non-blocking — local commits succeed regardless. Check `GET /vcs/status` for push error details.

See the [Version Control (VCS) Guide](./version-control.md) for full details on configuration, squash retention, AI commit messages, and troubleshooting.

---

## Troubleshooting

### Watcher won't start

**Check:**

1. Is Qdrant running? `curl http://localhost:6333/healthz`
2. Is config valid? `jeeves-watcher config validate -c /path/to/config.json`
3. Are referenced environment variables set in the service's environment? (`echo $GOOGLE_API_KEY` only checks your shell)
4. Check logs for errors

### Files not being indexed

**Check:**

1. Are files matched by `watch.paths` globs?
2. Are files excluded by `watch.ignored` globs, or by a `.gitignore` (`watch.respectGitignore`, default `true`)?
3. Does extraction produce text? (Extensions without a dedicated extractor are read as plain text.)
4. Check `GET /issues` (`jeeves-watcher issues`) for recorded failures
5. Check logs for extraction errors, or (at `debug` level) for `Skipping empty document`

### Search returns no results

**Check:**

1. Are files indexed? `jeeves-watcher status` (see `health.collection.pointCount`)
2. Is query relevant to corpus content?
3. Is embedding provider working? (Check logs for embedding errors)
4. Try broader query terms

### High memory usage

**Possible causes:**

- Large documents buffered during processing
- High `embedding.concurrency` (multiple documents in memory)

**Solutions:**

- Reduce `embedding.concurrency`
- Reduce `embedding.chunkSize` (smaller chunks = less memory per document)
- Add memory limits in service config

---

## Next Steps

- [Configuration Reference](./configuration.md) — Tune performance settings
- [API Reference](./api-reference.md) — Monitor via HTTP endpoints
- [Architecture Guide](./architecture.md) — Understand internals for debugging

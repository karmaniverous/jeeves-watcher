---
title: Deployment Guide
---

# Deployment Guide

Production deployment recommendations for `jeeves-watcher`.

---

## Prerequisites

### Node.js

**Version:** Node.js 20+ (Node.js 24+ recommended)

**Installation:**

- **Windows:** Download from [nodejs.org](https://nodejs.org/)
- **Linux:** Use nvm or distribution package manager
- **macOS:** Use nvm or Homebrew

**Verify:**

```bash
node --version  # Should be v20.0.0 or higher
```

### Qdrant

**Required:** Qdrant must be accessible before starting the watcher.

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

```json
{"title":"qdrant - vector search engine","version":"1.x.x"}
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
  host: 0.0.0.0         # Bind to all interfaces (default: 127.0.0.1)
  http_port: 6333       # HTTP API port
  grpc_port: 6334       # gRPC port

storage:
  storage_path: ./storage  # Data directory

telemetry_disabled: true   # Disable telemetry
```

For production, consider:
- **Snapshots:** Enable automatic snapshots for backups
- **Resource limits:** Set memory limits in `config.yaml`
- **Authentication:** Enable API key authentication for remote access

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
npx jeeves-watcher start
```

---

## Configuration

### Initialize Config

```bash
jeeves-watcher init --output /path/to/config.json
```

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
  "metadataDir": "/data/jeeves-watcher-metadata",
  "api": {
    "host": "127.0.0.1",
    "port": 3456
  },
  "logging": {
    "level": "info",
    "file": "/var/log/jeeves-watcher/watcher.log"
  },
  "shutdownTimeoutMs": 30000
}
```

### Environment Variables

**Set API keys:**

```bash
# Windows (PowerShell)
$env:GOOGLE_API_KEY = "your-key-here"

# Linux/macOS
export GOOGLE_API_KEY="your-key-here"
```

**For systemd services:** Add to unit file:

```ini
[Service]
Environment="GOOGLE_API_KEY=your-key-here"
```

**For NSSM services:** Set environment variables via NSSM:

```powershell
nssm set jeeves-watcher AppEnvironmentExtra "GOOGLE_API_KEY=your-key-here"
```

### Validate Config

```bash
jeeves-watcher validate --config /path/to/config.json
```

---

## Running as a Service

### Windows (NSSM)

**Install NSSM:** Download from [nssm.cc](https://nssm.cc/download)

**Generate install command:**

```bash
jeeves-watcher service install --config C:\path\to\config.json
```

Follow the printed instructions:

```powershell
nssm install jeeves-watcher node "C:\Users\YourUser\AppData\Roaming\npm\node_modules\@karmaniverous\jeeves-watcher\dist\cli\jeeves-watcher\index.js" start --config "C:\path\to\config.json"
nssm set jeeves-watcher AppDirectory "C:\working\directory"
nssm set jeeves-watcher Start SERVICE_AUTO_START
nssm set jeeves-watcher AppEnvironmentExtra "GOOGLE_API_KEY=your-key-here"
nssm start jeeves-watcher
```

**Manage service:**

```powershell
nssm status jeeves-watcher
nssm stop jeeves-watcher
nssm restart jeeves-watcher
```

**View logs:**

```powershell
nssm set jeeves-watcher AppStdout "C:\logs\jeeves-watcher-stdout.log"
nssm set jeeves-watcher AppStderr "C:\logs\jeeves-watcher-stderr.log"
```

**Uninstall:**

```powershell
nssm stop jeeves-watcher
nssm remove jeeves-watcher confirm
```

### Linux (systemd)

**Generate unit file:**

```bash
jeeves-watcher service install --config /etc/jeeves-watcher/config.json
```

Follow the printed instructions. Create `~/.config/systemd/user/jeeves-watcher.service`:

```ini
[Unit]
Description=Jeeves Watcher
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/youruser
ExecStart=/usr/bin/env jeeves-watcher start --config /etc/jeeves-watcher/config.json
Environment="GOOGLE_API_KEY=your-key-here"
Restart=on-failure
StandardOutput=append:/var/log/jeeves-watcher/watcher.log
StandardError=append:/var/log/jeeves-watcher/error.log

[Install]
WantedBy=default.target
```

**Enable and start:**

```bash
systemctl --user daemon-reload
systemctl --user enable --now jeeves-watcher.service
```

**Manage service:**

```bash
systemctl --user status jeeves-watcher
systemctl --user stop jeeves-watcher
systemctl --user restart jeeves-watcher
```

**View logs:**

```bash
journalctl --user -u jeeves-watcher -f
```

**Uninstall:**

```bash
systemctl --user disable --now jeeves-watcher.service
rm ~/.config/systemd/user/jeeves-watcher.service
systemctl --user daemon-reload
```

---

## Resource Profile

### Memory

| State | Memory Usage |
|-------|-------------|
| **Idle** (no events) | ~50–100MB |
| **Processing single file** | +5–20MB (document text in memory) |
| **Burst processing** | Bounded by `embedding.concurrency` × avg document size |

**Recommendation:** 512MB minimum, 1GB comfortable for moderate workloads.

### CPU

**I/O-wait dominated** — most time is spent waiting for embedding API responses.

| State | CPU Usage |
|-------|-----------|
| **Idle** | ~0% |
| **File extraction** | Brief spike (PDF/DOCX parsing) |
| **Embedding API waits** | ~0% (blocking I/O) |

**Recommendation:** 1 CPU core sufficient for most workloads.

### Disk

**Data:**
- **Metadata store:** ~1KB per enriched file (`.meta.json` sidecars)
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

| Service | Port | Memory | CPU | Role |
|---------|------|--------|-----|------|
| **Qdrant** | 6333 | 200MB–2GB | ~0% | Vector store |
| **jeeves-watcher** | 3456 | 100MB–1GB | ~5% | Indexing + search API |
| **jeeves-server** | 3456 | 50MB | ~1% | File browser + web UI |
| **n8n** | 5678 | 500MB–2GB | 10–50% | Workflow automation |
| **OpenClaw** | varies | 2–8GB | 50–100% | LLM inference |

**Total:** ~8–16GB RAM, 4 CPU cores recommended.

**Contention:**
- **Gemini API:** Watcher and OpenClaw use different providers (minimal contention)
- **Qdrant:** Watcher writes, n8n/jeeves-server read (native concurrent access)
- **Disk I/O:** All services write logs; stagger heavy operations

---

## Initial Indexing

### Estimate Time and Cost

| Corpus Size | Time (5 concurrent, 1000 req/min) | Gemini Cost ($0.15/1M tokens) |
|------------|----------------------------------|-------------------------------|
| 1,000 files | ~1 minute | ~$0.03 |
| 10,000 files | ~10 minutes | ~$0.30 |
| 100,000 files | ~100 minutes | ~$3.00 |

**Assumptions:** Average 500 tokens per document. Chunked documents (>1000 chars) require multiple embeddings.

**Schedule:** For large corpora, run initial indexing during off-hours to avoid rate limit contention.

### Run Initial Indexing

```bash
# Start watcher (performs initial scan automatically)
jeeves-watcher start --config /path/to/config.json
```

Or manually trigger:

```bash
jeeves-watcher reindex --port 3456
```

**Monitor progress:** Check logs for `File processed successfully` entries.

---

## Monitoring

### Health Checks

**HTTP endpoint:**

```bash
curl http://localhost:3456/status
```

Output:

```json
{
  "status": "ok",
  "uptime": 86400
}
```

**Use in monitoring:** Poll `/status` every 60s. Alert if non-200 response.

### Logs

**Structured JSON logging** via pino. Example log entry:

```json
{
  "level": "info",
  "time": 1708435200000,
  "filePath": "d:/docs/readme.md",
  "chunks": 2,
  "msg": "File processed successfully"
}
```

**Parse with standard tools:** jq, Splunk, ELK stack, etc.

**Log rotation:** Use external tools (logrotate on Linux, nssm log rotation on Windows).

### Alerts

**Critical events to alert on:**
- `level: "error"` entries (embedding API failures, Qdrant write failures)
- `/status` endpoint down for >5 minutes
- Dead-letter list growth (indicates persistent failures)

---

## Backup and Recovery

### Backup Strategy

**Qdrant:**
- Use Qdrant's built-in [snapshot feature](https://qdrant.tech/documentation/concepts/snapshots/)
- Automated snapshots to persistent storage
- Alternatively: copy `{qdrant_storage_path}` directory while Qdrant is stopped

**Metadata store:**
- Backup `{metadataDir}` directory
- Simple filesystem copy (no special handling needed)

**Config:**
- Backup `config.json`
- Store in version control (git)

### Recovery

**Scenario 1: Qdrant data lost**

1. Restore Qdrant snapshot (if available)
2. OR run full reindex:

```bash
jeeves-watcher reindex --port 3456
```

This rebuilds Qdrant from filesystem + metadata store.

**Scenario 2: Metadata store lost**

1. Rebuild from Qdrant:

```bash
jeeves-watcher rebuild-metadata --port 3456
```

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

**Current limitation:** Single-writer design (only one watcher instance per Qdrant collection).

**Future:** Planned support for distributed processing via job queue (Bull/BullMQ).

---

## Security

### API Access

**Default:** Binds to `127.0.0.1` (localhost only).

**For remote access:**
1. Bind to `0.0.0.0` (all interfaces)
2. Add reverse proxy with authentication (nginx, Caddy)
3. Use TLS/HTTPS

**Example nginx config:**

```nginx
location /watcher/ {
    proxy_pass http://127.0.0.1:3456/;
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

## Troubleshooting

### Watcher won't start

**Check:**
1. Is Qdrant running? `curl http://localhost:6333/healthz`
2. Is config valid? `jeeves-watcher validate --config /path/to/config.json`
3. Are API keys set? `echo $GOOGLE_API_KEY`
4. Check logs for errors

### Files not being indexed

**Check:**
1. Are files matched by `watch.paths` globs?
2. Are files excluded by `watch.ignored` globs?
3. Is file extraction supported? (Check extractor for file type)
4. Check logs for `Skipping empty file` or extraction errors

### Search returns no results

**Check:**
1. Are files indexed? `jeeves-watcher status`
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

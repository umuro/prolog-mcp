# prolog-mcp

An MCP server that wraps SWI-Prolog as a persistent symbolic reasoning engine for coding agents. Connect Claude Code, OpenClaw, Gemini CLI, or any MCP-compatible client to a local Prolog knowledge base — write rules, assert facts, and query results deterministically, without trusting an LLM to do the relational reasoning itself.

---

## Motivation

LLMs hallucinate on structured relational reasoning. Prolog does not. An agent can know the rules for message routing, scheduling constraints, or conflict detection — and still apply them incorrectly when reasoning in natural language. The gap between "the agent knows the rules" and "the agent correctly applies the rules" is exactly where a symbolic engine earns its place.

`prolog-mcp` gives coding agents a small, local, persistent Prolog runtime they can read and write through standard MCP tools. The agent authors `.pl` files, asserts facts, and queries the knowledge base. SWI-Prolog does the inference. The agent interprets the results.

---

## What It Brings to Coding Agents

**Conflict detection** — encode cron job schedules as Prolog facts, query for overlapping periods. No manual interval arithmetic, no hallucinated results.

**Routing rules** — express message routing, handler dispatch, or load-balancing policies as Prolog clauses. Query `handles(billing, Channel)` and get the correct channel back.

**Constraint solving** — model scheduling problems, resource contention, or planning tasks as Prolog goals. The engine backtracks; the agent just reads the solutions.

**Agent self-knowledge** — agents accumulate facts about their own state (`user_preference/3`, `session_context/2`, `task_status/2`) into a per-agent layer. Queries run against the shared KB, so agents can see each other's public facts.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          HOST MACHINE                           │
│                                                                 │
│  Claude Code ──MCP(stdio)──► prolog-mcp ──HTTP──► swipl :7474  │
│  (authors .pl via tools,               └── kbDir/*.pl           │
│   queries results)                                              │
│                                                                 │
│  Docker: openclaw-gateway                                       │
│  OpenClaw agents ──MCP(stdio)──► prolog-mcp (same process)     │
│  (query / assert / retract)                                     │
└─────────────────────────────────────────────────────────────────┘
```

`prolog-mcp` is a single Node.js process. Claude Code connects via stdio (standard MCP). OpenClaw agents connect via a second stdio connection — both share the same SWI-Prolog backend on `localhost:7474`.

---

## Prerequisites

- **SWI-Prolog** (tested with 9.x):
  ```bash
  # Debian / Ubuntu
  sudo apt install swi-prolog

  # macOS
  brew install swi-prolog
  ```

- **Node.js 22+**

---

## Installation

```bash
git clone https://github.com/umuro/prolog-mcp
cd prolog-mcp
npm install && npm run build
```

---

## Quick Start

**Step 1 — Start the SWI-Prolog daemon:**

```bash
bash prolog/start.sh
```

The daemon starts on `localhost:7474`. The script is idempotent — safe to call again if it is already running.

**Step 2 — Register the MCP server** (see configuration snippets below for Claude Code, OpenClaw, Gemini CLI, and Crush).

**Step 3 — First query:**

```json
// Tool: prolog_write_file
{ "path": "scratch/hello.pl", "content": "greeting(world)." }

// Tool: prolog_query
{ "goal": "greeting(X)" }
// → { "solutions": [{ "X": "world" }], "exhausted": true }
```

---

## Registration

### Claude Code (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "prolog": {
      "command": "node",
      "args": ["~/prolog-mcp/dist/index.js"],
      "env": { "KB_DIR": "~/.local/share/prolog-mcp" }
    }
  }
}
```

### OpenClaw (`~/.openclaw/openclaw.json`)

```json
{
  "tools": {
    "mcp": {
      "servers": {
        "prolog": {
          "transport": "stdio",
          "command": "node",
          "args": ["~/prolog-mcp/dist/index.js"],
          "env": { "KB_DIR": "~/.local/share/prolog-mcp" }
        }
      }
    }
  }
}
```

### Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "prolog": {
      "command": "node",
      "args": ["~/prolog-mcp/dist/index.js"],
      "env": { "KB_DIR": "~/.local/share/prolog-mcp" }
    }
  }
}
```

### Crush (`~/.config/crush/crush.json`)

```json
{
  "mcpServers": {
    "prolog": {
      "type": "stdio",
      "command": "node",
      "args": ["~/prolog-mcp/dist/index.js"],
      "env": { "KB_DIR": "~/.local/share/prolog-mcp" }
    }
  }
}
```

> **Note:** `KB_DIR` must be a fully expanded absolute path. The server resolves `~` via `os.homedir()` at startup as a convenience, but an explicit absolute path is recommended for non-interactive contexts.

---

## Tool Reference

### `prolog_query`

Execute a Prolog goal across all loaded KB layers. Returns all solutions.

```json
// Request
{ "goal": "ancestor(tom, X)", "timeout_ms": 5000 }

// All solutions found
{ "solutions": [{ "X": "bob" }, { "X": "ann" }], "exhausted": true }

// No solutions — not an error
{ "solutions": [], "exhausted": true }

// Timeout with partial results
{ "error": "timeout", "partial": [{ "X": "bob" }] }
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `goal` | string | required | Prolog goal to execute |
| `timeout_ms` | number | 5000 | Hard timeout in milliseconds |

---

### `prolog_assert`

Assert a fact into a writable layer. Defaults to the current session layer.

```json
{ "term": "user_preference(alice, dark_mode, true)", "layer": "agent:main" }
→ { "ok": true }
```

`"core"` is not a valid layer for assert — it is read-only at runtime. Use `prolog_write_file` to update `core.pl`.

Valid layer values: `"agent:<id>"` | `"session:<id>"`

---

### `prolog_retract`

Remove matching facts from a writable layer. Layer is required. `"core"` is rejected.

```json
{ "term": "user_preference(alice, dark_mode, true)", "layer": "agent:main" }
→ { "ok": true, "removed": 1 }
```

---

### `prolog_write_file`

Write a `.pl` file into `kbDir` and hot-reload it. Path must be relative and contained within `kbDir` (no `..` segments). Max file size: 512 KB. On syntax error: returns error and rolls back to the previous file content — the server keeps running.

```json
{ "path": "scratch/conflicts.pl", "content": "conflicts(A,B) :- ..." }
→ { "ok": true, "clauses": 6 }

// Syntax error
→ { "error": "syntax_error", "detail": "line 3: unexpected token ':-'" }
```

---

### `prolog_load_file`

Hot-reload an existing `.pl` file already on disk. Same path constraints as `prolog_write_file`.

```json
{ "path": "agents/main.pl" }
→ { "ok": true, "clauses": 14 }
```

---

### `prolog_list_facts`

Inspect facts in a layer. Default limit: 100. Returns `truncated: true` when more exist.

```json
{ "layer": "agent:main", "functor": "user_preference", "limit": 50 }
→ { "facts": ["user_preference(alice, dark_mode, true)."], "truncated": false }
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `layer` | string | — | Filter by layer |
| `functor` | string | — | Filter by predicate name |
| `limit` | number | 100 | Max facts to return |
| `offset` | number | 0 | Pagination offset |

---

### `prolog_reset_layer`

Clear a session or scratch layer. Rejects `"core"` and `"agent:*"` — permanent layers cannot be bulk-reset via this tool.

```json
{ "layer": "session:abc123" }
→ { "ok": true, "removed": 17 }
```

---

## KB Layer Model

All layers are visible to all queries — cross-agent fact visibility is intentional. Each layer file is loaded into its own named SWI module to prevent predicate shadowing; queries run in a unified context that imports all active modules.

| Layer | Path | Who writes | Lifetime |
|-------|------|-----------|---------|
| `core` | `core.pl` | Claude Code only (via `prolog_write_file`) | Permanent |
| `agent:<id>` | `agents/<id>.pl` | That agent (via `prolog_assert`) | Permanent |
| `session:<id>` | `sessions/<id>.pl` | Any agent in that session | Session lifetime |
| `scratch` | `scratch/<ts>.pl` | Claude Code only | Manual reset |

Session files are deleted when the session ends. Scratch files persist until `prolog_reset_layer("scratch")` is called or they are removed manually.

**Bulk-reset of agent layers is intentionally not available via MCP.** Operator escape hatch for stale agent facts: delete `agents/<id>.pl` directly, then call `prolog_load_file("agents/<id>.pl")` with an empty file to unload the predicates from SWI memory.

---

## Examples

Examples live in [`docs/examples/`](docs/examples/).

| File | What it shows |
|------|--------------|
| [`conflict-detection.pl`](docs/examples/conflict-detection.pl) | Detect overlapping cron jobs using period divisibility rules |
| [`routing-rules.pl`](docs/examples/routing-rules.pl) | Express message routing policies with a default fallback clause |

### Conflict detection workflow

```
User: "Which cron jobs conflict?"

1. Claude Code reads cron job list
2. prolog_write_file("scratch/conflicts.pl", <generated Prolog>)
3. prolog_query("conflicts(X, Y)")
   → { "solutions": [{ "X": "brain_watchdog", "Y": "linkedin_mon" }] }
4. Claude Code explains result
```

### Routing rules workflow

```
Agent receives message about "billing":
1. prolog_query("handles(billing, Channel)")
   → { "solutions": [{ "Channel": "telegram" }] }

Agent learns new fact:
2. prolog_assert("user_preference(alice, dark_mode, true)", "agent:main")
   → { "ok": true }  // persisted to agents/main.pl
```

---

## Configuration

All settings can be provided via environment variables or a `prolog-mcp.json` in the working directory:

```json
{
  "swiplPort": 7474,
  "kbDir": "/home/user/.local/share/prolog-mcp",
  "defaultQueryTimeoutMs": 5000,
  "maxFileSizeBytes": 524288,
  "autoRestartSwipl": true,
  "writeableLayers": ["agent", "session"]
}
```

| Key | Env var | Default |
|-----|---------|---------|
| `swiplPort` | `SWIPL_PORT` | `7474` |
| `kbDir` | `KB_DIR` | `~/.local/share/prolog-mcp` |
| `defaultQueryTimeoutMs` | `QUERY_TIMEOUT_MS` | `5000` |
| `maxFileSizeBytes` | `MAX_FILE_SIZE` | `524288` |
| `autoRestartSwipl` | `AUTO_RESTART` | `true` |

---

## Security Notes

| Concern | Mitigation |
|---------|-----------|
| Agent writes rules to `core.pl` via assert | `prolog_assert` and `prolog_retract` reject `"core"` layer at runtime |
| Path traversal via `prolog_write_file` | `path-guard.ts` rejects any path outside `kbDir`; rejects `..` segments |
| Infinite query loops | `call_with_time_limit/2` hard timeout per query (default 5 s) |
| Oversized file writes | 512 KB max enforced before write |
| Syntax error crashing the server | Write wrapped in rollback transaction — server keeps running, file reverted |
| Double-start race on health restart | Mutex in `server-health.ts`; `start.sh` is idempotent (PID-file guarded) |
| Concurrent writes to the same layer | Per-layer async write queue in `layer-manager.ts` |

**Trust model:** `core.pl` and `agents/<id>.pl` are permanent and writable only by the operator or the owning agent, respectively. Session and scratch layers are ephemeral. All writable paths are validated against `kbDir` before any disk operation.

---

## License

MIT

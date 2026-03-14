---
name: prolog-mcp project state
description: Current status, completed work, deferred tasks, and next milestone
type: project
---

# prolog-mcp Project State

Last updated: 2026-03-14

## What it is
MCP server wrapping SWI-Prolog for symbolic reasoning in coding agents.
Architecture: Claude Code → stdio → Node.js MCP → HTTP → swipl :7474

## Branch status
- `develop` — active work branch
- `main` — last stable release baseline

## Completed this session
- Fixed 8 agent-facing blunders (commit 6a9e451):
  1. `prolog_retract` only in-memory → now file-backed via `/retract_file`
  2. Trailing dot in term → double-period syntax error → strip in `termToString`
  3. `handle_load` double-reply on syntax error → rollback was skipped → fixed
  4. `functor` filter silently ignored when `layer` also given → fixed
  5. `offset > length` returned page 0 → now returns `[]`
  6. Bare `"agent"` layer passed guard, threw in `resolvePath` → validated
  7. `prolog_assert` default layer `session:default` → changed to `agent:main`
  8. Global `clause/2` instantiation error in SWI 9.x → use `current_predicate`
- Added tests for all 8 fixes (term-codec, prolog-http, mcp-tools e2e)
- Added `prepublish` build script to package.json
- Fixed `prolog_write_file` description to warn it replaces the entire file

## Outstanding / deferred

### Known limitation (not fully fixed)
- `prolog_reset_layer` may miss in-memory facts that were assertz'd via raw
  HTTP `/assert` and never written to the layer file. This is a narrow edge
  case — the MCP `prolog_assert` always writes to disk first, so normal agent
  usage is unaffected. Full fix requires per-layer module isolation in SWI.

## Next milestone: README tutorial + merge to main + GitHub push

When all tests pass on develop, the next task is:
1. Write a comprehensive README with:
   - Setup instructions (macOS with Homebrew, Ubuntu/Debian)
   - Quick start (start daemon → register MCP → first query)
   - Full tool reference (already in current README, may need update)
   - Case studies:
     a. Circular dependency detection (the demo from this session)
     b. Routing rules with runtime assert/retract
     c. Scheduling conflict detection (cron overlap)
   - Layer model explanation (core / agent / session / scratch)
   - Configuration reference
2. Merge `develop` → `main`
3. Push to GitHub (umuro/prolog-mcp)

## How to run
```bash
bash prolog/start.sh          # start swipl daemon on :7474
npm run build                 # compile TypeScript
npm test                      # run all tests (requires swipl)
```

## Key files
- `prolog/server.pl` — SWI-Prolog HTTP server (all endpoints)
- `prolog/start.sh` — daemon launcher (idempotent, PID-guarded)
- `src/index.ts` — MCP tool definitions (the agent-facing API)
- `src/layer-manager.ts` — layer file I/O with async write queue
- `src/prolog-http.ts` — HTTP client for swipl endpoints
- `test/mcp-tools.test.ts` — end-to-end MCP stdio protocol tests

#!/usr/bin/env node
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, ensureKbDirs } from "./config.js";
import { PrologHttp } from "./prolog-http.js";
import { LayerManager } from "./layer-manager.js";
import { createServerHealth } from "./server-health.js";
import { guardPath } from "./path-guard.js";
import { goalToString, termToString } from "./term-codec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const cfg = loadConfig();
  ensureKbDirs(cfg);

  const http = new PrologHttp(cfg.swiplPort);
  const layers = new LayerManager(cfg.kbDir);
  const health = createServerHealth({
    port: cfg.swiplPort,
    kbDir: cfg.kbDir,
    scriptDir: path.resolve(__dirname, "../prolog"),
    checkFn: () => http.health(),
  });

  if (cfg.autoRestartSwipl) await health.ensureRunning();

  const server = new McpServer({ name: "prolog-mcp", version: "0.1.0" });

  async function guard() {
    if (cfg.autoRestartSwipl) await health.ensureRunning();
  }

  // ── prolog_query ─────────────────────────────────────────────
  server.tool(
    "prolog_query",
    "Execute a Prolog goal and return all solutions as JSON",
    {
      goal: z.string().describe("Prolog goal, e.g. 'ancestor(tom, X)'"),
      timeout_ms: z.number().optional().describe("Timeout in ms (default 5000)"),
    },
    async ({ goal, timeout_ms }) => {
      await guard();
      const result = await http.query(goalToString(goal), timeout_ms ?? cfg.defaultQueryTimeoutMs);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── prolog_assert ─────────────────────────────────────────────
  server.tool(
    "prolog_assert",
    "Assert a fact or rule into the KB. Persists to disk and survives daemon restarts. Use agent:main (default) for permanent knowledge; use session:<id> for ephemeral facts tied to the current session.",
    {
      term: z.string().describe("Prolog fact or rule, e.g. 'handles(billing, telegram)' or 'route(X,C) :- handles(X,C)'"),
      layer: z.string().optional().describe("'agent:<id>' for permanent storage (default: agent:main) or 'session:<id>' for session-scoped ephemeral storage"),
    },
    async ({ term, layer = "agent:main" }) => {
      if (!layer.includes(":")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid_layer", detail: "layer must be 'agent:<id>' or 'session:<id>'" }) }] };
      }
      const prefix = layer.split(":")[0];
      if (!cfg.writeableLayers.includes(prefix)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "layer_readonly", layer }) }] };
      }
      await guard();
      await layers.appendToLayer(layer, termToString(term) + ".");
      await http.loadFile(layers.resolvePath(layer));
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
    }
  );

  // ── prolog_retract ────────────────────────────────────────────
  server.tool(
    "prolog_retract",
    "Retract matching facts or rules from a layer. Removes from disk and reloads — retraction survives daemon restarts.",
    {
      term: z.string().describe("Prolog fact or rule head to retract, e.g. 'handles(billing, telegram)'"),
      layer: z.string().describe("'agent:<id>' or 'session:<id>' — must include the colon and an id"),
    },
    async ({ term, layer }) => {
      if (!layer.includes(":")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid_layer", detail: "layer must be 'agent:<id>' or 'session:<id>'" }) }] };
      }
      const prefix = layer.split(":")[0];
      if (!cfg.writeableLayers.includes(prefix)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "layer_readonly", layer }) }] };
      }
      await guard();
      const filePath = layers.resolvePath(layer);
      const result = await http.retractFromFile(termToString(term), filePath);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── prolog_write_file ─────────────────────────────────────────
  server.tool(
    "prolog_write_file",
    "Write a .pl file to disk and hot-reload it. WARNING: replaces the entire file — not an append. Use for authoring multi-clause rule files (core.pl, scratch/). For individual facts use prolog_assert instead. On syntax error the file is rolled back and the server keeps running.",
    {
      path: z.string().describe("Relative path inside kbDir, e.g. 'core.pl' or 'scratch/foo.pl'"),
      content: z.string().describe("Complete Prolog source — the full file content, not just the new clause"),
    },
    async ({ path: userPath, content }) => {
      const filePath = guardPath(cfg.kbDir, userPath);
      if (content.length > cfg.maxFileSizeBytes) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "file_too_large", max: cfg.maxFileSizeBytes }) }] };
      }
      const backup = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, "utf8")
        : null;
      fs.writeFileSync(filePath, content, "utf8");
      await guard();
      const result = await http.loadFile(filePath);
      if ("error" in result && backup !== null) {
        fs.writeFileSync(filePath, backup, "utf8");
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── prolog_load_file ──────────────────────────────────────────
  server.tool(
    "prolog_load_file",
    "Hot-reload an existing .pl file",
    {
      path: z.string().describe("Relative path inside kbDir"),
    },
    async ({ path: userPath }) => {
      const filePath = guardPath(cfg.kbDir, userPath);
      await guard();
      const result = await http.loadFile(filePath);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── prolog_list_facts ─────────────────────────────────────────
  server.tool(
    "prolog_list_facts",
    "List facts in the KB, optionally filtered by functor",
    {
      layer: z.string().optional().describe("Filter by layer, e.g. 'agent:main' or 'session:abc'"),
      functor: z.string().optional().describe("Filter by functor name"),
      limit: z.number().optional().describe("Max results (default 100)"),
      offset: z.number().optional().describe("Skip first N results"),
    },
    async (opts) => {
      await guard();
      const result = await http.listFacts(opts);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── prolog_reset_layer ────────────────────────────────────────
  server.tool(
    "prolog_reset_layer",
    "Clear a session or scratch layer (core and agent layers are permanent)",
    {
      layer: z.string().describe("'session:<id>' or 'scratch'"),
    },
    async ({ layer }) => {
      const prefix = layer.split(":")[0];
      if (prefix === "core" || prefix === "agent") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "layer_readonly", layer }) }] };
      }
      await guard();
      const filePath = layers.resolvePath(layer);
      const result = await http.resetLayer(filePath);
      if (prefix === "session") await layers.deleteSessionLayer(layer);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  await server.connect(new StdioServerTransport());
}

main().catch(console.error);

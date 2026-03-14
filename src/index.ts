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
    "Assert a fact into an agent or session layer (core is read-only)",
    {
      term: z.string().describe("Prolog term, e.g. 'parent(ann, sue)'"),
      layer: z.string().optional().describe("'agent:<id>' or 'session:<id>' (default: session:default)"),
    },
    async ({ term, layer = "session:default" }) => {
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
    "Retract matching facts from a layer",
    {
      term: z.string().describe("Prolog term to retract"),
      layer: z.string().describe("'agent:<id>' or 'session:<id>'"),
    },
    async ({ term, layer }) => {
      const prefix = layer.split(":")[0];
      if (!cfg.writeableLayers.includes(prefix)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "layer_readonly", layer }) }] };
      }
      await guard();
      const result = await http.retract(termToString(term), layer);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── prolog_write_file ─────────────────────────────────────────
  server.tool(
    "prolog_write_file",
    "Write a .pl file to disk and hot-reload it (use for core.pl authoring)",
    {
      path: z.string().describe("Relative path inside kbDir, e.g. 'core.pl' or 'scratch/foo.pl'"),
      content: z.string().describe("Full Prolog source content"),
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

// src/config.ts
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Config } from "./types.js";

const DEFAULTS: Config = {
  swiplPort: 7474,
  kbDir: path.join(os.homedir(), ".local", "share", "prolog-mcp"),
  defaultQueryTimeoutMs: 5000,
  maxFileSizeBytes: 524288,
  autoRestartSwipl: true,
  writeableLayers: ["agent", "session"],
};

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function loadConfig(): Config {
  const configPath =
    process.env.PROLOG_MCP_CONFIG ??
    path.join(os.homedir(), ".config", "prolog-mcp.json");

  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<Config>;
  }

  const cfg: Config = {
    ...DEFAULTS,
    ...fileConfig,
    ...(process.env.KB_DIR ? { kbDir: process.env.KB_DIR } : {}),
    ...(process.env.SWIPL_PORT
      ? (() => {
          const p = parseInt(process.env.SWIPL_PORT!, 10);
          return Number.isFinite(p) ? { swiplPort: p } : {};
        })()
      : {}),
  };

  cfg.kbDir = expandHome(cfg.kbDir);
  return cfg;
}

export function ensureKbDirs(cfg: Config): void {
  for (const sub of ["agents", "sessions", "scratch"]) {
    fs.mkdirSync(path.join(cfg.kbDir, sub), { recursive: true });
  }
  const corePath = path.join(cfg.kbDir, "core.pl");
  if (!fs.existsSync(corePath)) {
    fs.writeFileSync(corePath, "% core knowledge base\n", "utf8");
  }
}

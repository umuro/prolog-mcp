// test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { loadConfig, ensureKbDirs } from "../src/config.js";

// -------------------------------------------------------------------
// loadConfig
// -------------------------------------------------------------------
describe("loadConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["KB_DIR", "SWIPL_PORT", "PROLOG_MCP_CONFIG"]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    // Point config file at a path that definitely does not exist so the
    // file-merge branch is skipped and only env / defaults apply.
    process.env.PROLOG_MCP_CONFIG =
      "/tmp/definitely-does-not-exist-prolog-mcp-test.json";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns hard-coded defaults when no env vars and no config file", () => {
    const cfg = loadConfig();
    expect(cfg.swiplPort).toBe(7474);
    expect(cfg.defaultQueryTimeoutMs).toBe(5000);
    expect(cfg.maxFileSizeBytes).toBe(524288);
    expect(cfg.autoRestartSwipl).toBe(true);
    expect(cfg.writeableLayers).toEqual(["agent", "session"]);
    // kbDir default lives inside the user home dir
    expect(cfg.kbDir).toContain(".local/share/prolog-mcp");
  });

  it("KB_DIR env var overrides default kbDir", () => {
    process.env.KB_DIR = "/custom/kb/dir";
    const cfg = loadConfig();
    expect(cfg.kbDir).toBe("/custom/kb/dir");
  });

  it("SWIPL_PORT env var overrides default port", () => {
    process.env.SWIPL_PORT = "9999";
    const cfg = loadConfig();
    expect(cfg.swiplPort).toBe(9999);
  });

  it("invalid SWIPL_PORT (non-numeric) falls back to default 7474", () => {
    process.env.SWIPL_PORT = "notanumber";
    const cfg = loadConfig();
    // parseInt("notanumber", 10) === NaN → Number.isFinite(NaN) === false → ignored
    expect(cfg.swiplPort).toBe(7474);
  });

  it("SWIPL_PORT with leading zeros parses as decimal", () => {
    process.env.SWIPL_PORT = "08080";
    const cfg = loadConfig();
    // parseInt with radix 10 treats leading zeros as decimal
    expect(cfg.swiplPort).toBe(8080);
  });

  it("expands tilde in kbDir", () => {
    process.env.KB_DIR = "~/myprolog";
    const cfg = loadConfig();
    expect(cfg.kbDir).toBe(path.join(os.homedir(), "myprolog"));
  });

  it("tilde-only kbDir expands to homedir", () => {
    process.env.KB_DIR = "~";
    const cfg = loadConfig();
    // expandHome("~") → homedir + "" (slice(2) of "~" is "")
    expect(cfg.kbDir).toBe(os.homedir());
  });

  it("non-tilde path is returned unchanged", () => {
    process.env.KB_DIR = "/absolute/path";
    const cfg = loadConfig();
    expect(cfg.kbDir).toBe("/absolute/path");
  });
});

// -------------------------------------------------------------------
// ensureKbDirs
// -------------------------------------------------------------------
describe("ensureKbDirs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prolog-cfg-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function makeMinimalCfg(kbDir: string) {
    return {
      swiplPort: 7474,
      kbDir,
      defaultQueryTimeoutMs: 5000,
      maxFileSizeBytes: 524288,
      autoRestartSwipl: false,
      writeableLayers: ["agent", "session"],
    };
  }

  it("creates agents, sessions, and scratch subdirs", () => {
    ensureKbDirs(makeMinimalCfg(tmpDir));
    expect(fs.existsSync(path.join(tmpDir, "agents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "sessions"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "scratch"))).toBe(true);
  });

  it("creates core.pl when it does not yet exist", () => {
    ensureKbDirs(makeMinimalCfg(tmpDir));
    const corePath = path.join(tmpDir, "core.pl");
    expect(fs.existsSync(corePath)).toBe(true);
    expect(fs.readFileSync(corePath, "utf8")).toContain("core knowledge base");
  });

  it("does not overwrite an existing core.pl", () => {
    const corePath = path.join(tmpDir, "core.pl");
    fs.writeFileSync(corePath, "my_existing_rule(x).\n", "utf8");
    ensureKbDirs(makeMinimalCfg(tmpDir));
    expect(fs.readFileSync(corePath, "utf8")).toBe("my_existing_rule(x).\n");
  });

  it("is idempotent — calling twice does not throw", () => {
    const cfg = makeMinimalCfg(tmpDir);
    expect(() => {
      ensureKbDirs(cfg);
      ensureKbDirs(cfg);
    }).not.toThrow();
  });

  it("creates subdirs even when kbDir itself does not exist yet", () => {
    const nested = path.join(tmpDir, "deep", "nested");
    // kbDir does not exist; mkdirSync with recursive:true should handle it
    ensureKbDirs(makeMinimalCfg(nested));
    expect(fs.existsSync(path.join(nested, "agents"))).toBe(true);
  });
});

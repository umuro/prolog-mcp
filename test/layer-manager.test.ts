// test/layer-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LayerManager } from "../src/layer-manager.js";

let tmpDir: string;
let mgr: LayerManager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prolog-mcp-"));
  fs.mkdirSync(path.join(tmpDir, "agents"));
  fs.mkdirSync(path.join(tmpDir, "sessions"));
  fs.mkdirSync(path.join(tmpDir, "scratch"));
  mgr = new LayerManager(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe("resolvePath", () => {
  it("resolves agent layer", () => {
    expect(mgr.resolvePath("agent:main")).toBe(
      path.join(tmpDir, "agents", "main.pl")
    );
  });

  it("resolves session layer", () => {
    expect(mgr.resolvePath("session:abc")).toBe(
      path.join(tmpDir, "sessions", "abc.pl")
    );
  });

  it("rejects core for write", () => {
    expect(() => mgr.resolvePath("core", { write: true })).toThrow("layer_readonly");
  });

  it("resolves core for read", () => {
    expect(mgr.resolvePath("core")).toBe(path.join(tmpDir, "core.pl"));
  });
});

describe("writeToLayer", () => {
  it("writes content to file", async () => {
    await mgr.writeToLayer("agent:main", "foo(bar).\n");
    expect(fs.readFileSync(path.join(tmpDir, "agents", "main.pl"), "utf8"))
      .toBe("foo(bar).\n");
  });

  it("serializes concurrent writes — last write wins without corruption", async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mgr.writeToLayer("agent:main", `fact(${i}).\n`)
      )
    );
    const content = fs.readFileSync(path.join(tmpDir, "agents", "main.pl"), "utf8");
    // Content must be exactly one of the 5 writes — no corruption/interleaving
    expect(content).toMatch(/^fact\(\d\)\.\n$/);
  });
});

describe("deleteSessionLayer", () => {
  it("deletes existing session file", async () => {
    const p = path.join(tmpDir, "sessions", "s1.pl");
    fs.writeFileSync(p, "x(1).\n");
    await mgr.deleteSessionLayer("session:s1");
    expect(fs.existsSync(p)).toBe(false);
  });

  it("does not throw if file missing", async () => {
    await expect(mgr.deleteSessionLayer("session:ghost")).resolves.not.toThrow();
  });
});

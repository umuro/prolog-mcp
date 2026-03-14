// test/prolog-http.test.ts
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { PrologHttp } from "../src/prolog-http.js";
import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function hasSwipl() {
  try { execSync("which swipl", { stdio: "ignore" }); return true; }
  catch { return false; }
}

const SKIP = !hasSwipl();
const PORT = 17474;
let swiplProc: ReturnType<typeof spawn> | null = null;
let tmpDir: string;

beforeAll(async () => {
  if (SKIP) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prolog-int-"));
  fs.mkdirSync(path.join(tmpDir, "agents"));
  fs.mkdirSync(path.join(tmpDir, "sessions"));
  fs.writeFileSync(path.join(tmpDir, "core.pl"), "parent(tom,bob).\n");
  swiplProc = spawn("swipl", ["-q", path.resolve("prolog/server.pl")], {
    env: { ...process.env, SWIPL_PORT: String(PORT), KB_DIR: tmpDir },
  });
  await new Promise((r) => setTimeout(r, 2000));
});

afterAll(() => {
  swiplProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
});

describe.skipIf(SKIP)("PrologHttp integration", () => {
  const http = new PrologHttp(PORT);

  it("health returns true", async () => {
    expect(await http.health()).toBe(true);
  });

  it("queries a ground fact", async () => {
    const r = await http.query("parent(tom, bob)") as any;
    expect(r.exhausted).toBe(true);
    expect(r.solutions.length).toBeGreaterThanOrEqual(1);
  });

  it("queries with unbound variable", async () => {
    const r = await http.query("parent(tom, X)") as any;
    expect(r.solutions.length).toBeGreaterThan(0);
  });

  it("asserts and queries new fact", async () => {
    await http.assert("color(sky, blue)", "session:test");
    const r = await http.query("color(sky, X)") as any;
    expect(r.solutions.length).toBeGreaterThan(0);
  });

  it("returns empty solutions for false goal", async () => {
    const r = await http.query("parent(nobody, X)") as any;
    expect(r.solutions).toEqual([]);
    expect(r.exhausted).toBe(true);
  });

  it("hot-reloads an already-loaded file", async () => {
    const plFile = path.join(tmpDir, "core.pl");
    // file already loaded at startup; overwrite with new fact and reload
    fs.writeFileSync(plFile, "parent(tom,bob).\nparent(tom,liz).\n");
    const loadResult = await http.loadFile(plFile) as any;
    expect(loadResult.ok).toBe(true);
    const r = await http.query("parent(tom, X)") as any;
    const names = r.solutions.map((s: any) => s.X);
    expect(names).toContain("liz");
  });

  it("listFacts returns only facts from requested layer", async () => {
    await http.assert("layertest(from_session)", "session:layercheck");
    const r = await http.listFacts({ layer: "session:layercheck" }) as any;
    expect(r.facts.some((f: string) => f.includes("layertest"))).toBe(true);
    // core facts (parent/2) should NOT appear
    expect(r.facts.some((f: string) => f.includes("parent"))).toBe(false);
  });
});

// Unit tests (no swipl needed)
describe("PrologHttp unit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("health returns false when server unreachable", async () => {
    const http = new PrologHttp(19999);
    expect(await http.health()).toBe(false);
  });

  it("constructs correct base URL", () => {
    const http = new PrologHttp(7474) as any;
    expect(http.baseUrl).toBe("http://localhost:7474");
  });

  it("listFacts passes layer to POST body", async () => {
    const http = new PrologHttp(19998);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ facts: [], truncated: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await http.listFacts({ layer: "agent:main", functor: "foo", limit: 10 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.layer).toBe("agent:main");
    expect(body.functor).toBe("foo");
  });

  it("listFacts omits layer key when not provided", async () => {
    const http = new PrologHttp(19998);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ facts: [], truncated: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await http.listFacts({ functor: "foo" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.layer).toBeUndefined();
  });
});

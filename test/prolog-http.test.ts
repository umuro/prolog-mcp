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
    // Write to the layer file on disk so file-based listing can find the fact.
    // Direct assertz (http.assert) has no file association, so layer filter won't see it.
    const layerFile = path.join(tmpDir, "sessions", "layercheck.pl");
    fs.writeFileSync(layerFile, "layertest(from_session).\n");
    await http.loadFile(layerFile);
    const r = await http.listFacts({ layer: "session:layercheck" }) as any;
    expect(r.facts.some((f: string) => f.includes("layertest"))).toBe(true);
    // core facts (parent/2) should NOT appear
    expect(r.facts.some((f: string) => f.includes("parent"))).toBe(false);
  });

  it("listFacts with offset skips leading facts", async () => {
    const pagFile = path.join(tmpDir, "sessions", "pagination.pl");
    fs.writeFileSync(pagFile, "pag(1).\npag(2).\npag(3).\n");
    await http.loadFile(pagFile);
    const all = await http.listFacts({ layer: "session:pagination" }) as any;
    expect(all.facts.length).toBe(3);
    const paged = await http.listFacts({ layer: "session:pagination", offset: 2 }) as any;
    expect(paged.facts.length).toBe(1);
  });

  it("retracts facts and returns removed count", async () => {
    await http.assert("color(sky, blue)", "session:retracttest");
    await http.assert("color(sea, blue)", "session:retracttest");
    const r = await http.retract("color(_, blue)", "session:retracttest") as any;
    expect(r.ok).toBe(true);
    expect(r.removed).toBeGreaterThanOrEqual(1);
  });

  it("resetLayer clears session facts", async () => {
    // write a file with a known fact then reset it
    const filePath = path.join(tmpDir, "sessions", "resetme.pl");
    fs.writeFileSync(filePath, "resetfact(yes).\n");
    await http.loadFile(filePath);
    const before = await http.query("resetfact(yes)") as any;
    expect(before.solutions.length).toBeGreaterThan(0);
    await http.resetLayer(filePath);
    const after = await http.query("resetfact(yes)") as any;
    expect(after.solutions).toEqual([]);
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

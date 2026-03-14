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
  fs.mkdirSync(path.join(tmpDir, "scratch"));
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

  it("retractFromFile removes matching term from disk and memory", async () => {
    const layerFile = path.join(tmpDir, "agents", "retractfile.pl");
    fs.writeFileSync(layerFile, "keep_me(yes).\nremove_me(yes).\n");
    await http.loadFile(layerFile);

    const before = await http.query("remove_me(yes)") as any;
    expect(before.solutions.length).toBe(1);

    const r = await http.retractFromFile("remove_me(yes)", layerFile) as any;
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(1);

    // removed from memory
    const afterMem = await http.query("remove_me(yes)") as any;
    expect(afterMem.solutions).toEqual([]);

    // removed from disk
    const contents = fs.readFileSync(layerFile, "utf8");
    expect(contents).not.toContain("remove_me");
    expect(contents).toContain("keep_me");
  });

  it("retractFromFile leaves file unchanged when term not found", async () => {
    const layerFile = path.join(tmpDir, "agents", "noop.pl");
    fs.writeFileSync(layerFile, "stay(here).\n");
    await http.loadFile(layerFile);

    const r = await http.retractFromFile("absent(fact)", layerFile) as any;
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(0);
    expect(fs.readFileSync(layerFile, "utf8")).toContain("stay");
  });

  it("handle_load returns a single valid JSON on syntax error (no double-reply)", async () => {
    const badFile = path.join(tmpDir, "scratch", "bad_syntax.pl");
    fs.writeFileSync(badFile, "broken :- .\n");
    const r = await http.loadFile(badFile) as any;
    // Must have an error key, not ok — confirming exactly one JSON reply
    expect(r.error).toBeDefined();
    expect(r.ok).toBeUndefined();
  });

  it("listFacts with layer+functor filters to matching functor only", async () => {
    const layerFile = path.join(tmpDir, "sessions", "mixed.pl");
    fs.writeFileSync(layerFile, "alpha(1).\nalpha(2).\nbeta(x).\n");
    await http.loadFile(layerFile);

    const r = await http.listFacts({ layer: "session:mixed", functor: "alpha" }) as any;
    expect(r.facts.every((f: string) => f.startsWith("alpha"))).toBe(true);
    expect(r.facts.some((f: string) => f.startsWith("beta"))).toBe(false);
    expect(r.facts.length).toBe(2);
  });

  it("listFacts offset beyond total length returns empty list", async () => {
    const layerFile = path.join(tmpDir, "sessions", "small.pl");
    fs.writeFileSync(layerFile, "tiny(1).\ntiny(2).\n");
    await http.loadFile(layerFile);

    const r = await http.listFacts({ layer: "session:small", offset: 999 }) as any;
    expect(r.facts).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("resetLayer clears assertz-only facts that never touched disk", async () => {
    // This is the edge case: /assert with a layer → in-memory only (no file write).
    // /reset must still remove these via the mcp_layer_track mechanism.
    await http.assert("orphan_fact(ghost)", "session:orphan_test");

    const before = await http.query("orphan_fact(ghost)") as any;
    expect(before.solutions.length).toBe(1);

    const orphanFile = path.join(tmpDir, "sessions", "orphan_test.pl");
    await http.resetLayer(orphanFile, "session:orphan_test");

    const after = await http.query("orphan_fact(ghost)") as any;
    expect(after.solutions).toEqual([]);
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

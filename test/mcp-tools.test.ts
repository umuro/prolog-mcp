// test/mcp-tools.test.ts
// End-to-end MCP protocol tests — spawns `node dist/index.js` and communicates
// via newline-delimited JSON-RPC over stdio, exercising the full tool-handler stack.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MCP_SWIPL_PORT = 17575;  // distinct from prolog-http.test.ts (17474)

function hasSwipl() {
  const r = spawnSync("swipl", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

const SKIP = !hasSwipl() || !fs.existsSync("dist/index.js");

// ---------------------------------------------------------------------------
// Minimal MCP stdio client (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------
class McpTestClient {
  private buf = "";
  private pending = new Map<number, (r: unknown) => void>();
  private nextId = 1;

  constructor(private proc: ReturnType<typeof spawn>) {
    proc.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      const lines = this.buf.split("\n");
      this.buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            this.pending.get(msg.id)!(msg);
            this.pending.delete(msg.id);
          }
        } catch { /* ignore parse errors on non-JSON stderr noise */ }
      }
    });
  }

  private send(msg: object) {
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  request(method: string, params?: object): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params: params ?? {} });
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0.1" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    await new Promise((r) => setTimeout(r, 50));
  }

  async callTool(name: string, args: object): Promise<unknown> {
    const resp = await this.request("tools/call", { name, arguments: args }) as any;
    const text = resp?.result?.content?.[0]?.text;
    if (text) return JSON.parse(text);
    return resp;
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
let client: McpTestClient;
let mcpProc: ReturnType<typeof spawn>;
let swiplProc: ReturnType<typeof spawn> | null = null;
let tmpDir: string;

beforeAll(async () => {
  if (SKIP) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prolog-mcp-e2e-"));
  fs.mkdirSync(path.join(tmpDir, "agents"));
  fs.mkdirSync(path.join(tmpDir, "sessions"));
  fs.mkdirSync(path.join(tmpDir, "scratch"));
  fs.writeFileSync(path.join(tmpDir, "core.pl"), "% e2e test core\n");

  // Pre-start swipl on a dedicated port so the MCP node process finds it
  // immediately and autoRestartSwipl's health check resolves without hanging.
  swiplProc = spawn("swipl", ["-q", path.resolve("prolog/server.pl")], {
    env: { ...process.env, SWIPL_PORT: String(MCP_SWIPL_PORT), KB_DIR: tmpDir },
  });
  swiplProc.stderr!.on("data", () => { /* suppress swipl startup noise */ });
  await new Promise((r) => setTimeout(r, 2000)); // let swipl bind its port

  mcpProc = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      KB_DIR: tmpDir,
      SWIPL_PORT: String(MCP_SWIPL_PORT),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  mcpProc.stderr!.on("data", () => { /* suppress */ });

  client = new McpTestClient(mcpProc);
  await new Promise((r) => setTimeout(r, 500));
  await client.initialize();
}, 20_000);

afterAll(() => {
  mcpProc?.kill();
  swiplProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
});

describe.skipIf(SKIP)("MCP tool handlers — end-to-end", () => {

  it("prolog_query returns solutions", async () => {
    const r = await client.callTool("prolog_query", { goal: "member(X, [a,b,c])" }) as any;
    expect(r.solutions).toHaveLength(3);
    expect(r.exhausted).toBe(true);
  });

  it("prolog_assert with default layer writes to agent:main on disk", async () => {
    const r = await client.callTool("prolog_assert", {
      term: "e2e_fact(hello)",
    }) as any;
    expect(r.ok).toBe(true);

    const filePath = path.join(tmpDir, "agents", "main.pl");
    const contents = fs.readFileSync(filePath, "utf8");
    expect(contents).toContain("e2e_fact(hello)");
  });

  it("prolog_assert persists a rule with body", async () => {
    await client.callTool("prolog_assert", { term: "e2e_base(x)" });
    await client.callTool("prolog_assert", {
      term: "e2e_derived(Y) :- e2e_base(Y)",
    });
    const r = await client.callTool("prolog_query", { goal: "e2e_derived(Y)" }) as any;
    expect(r.solutions.length).toBeGreaterThan(0);
    expect(r.solutions[0].Y).toBe("x");
  });

  it("prolog_assert strips trailing dot from agent-supplied term", async () => {
    const r = await client.callTool("prolog_assert", {
      term: "dotted_fact(ok).",
    }) as any;
    expect(r.ok).toBe(true);

    const q = await client.callTool("prolog_query", { goal: "dotted_fact(ok)" }) as any;
    expect(q.solutions.length).toBe(1);
  });

  it("prolog_assert rejects bare layer without colon", async () => {
    const r = await client.callTool("prolog_assert", {
      term: "foo(bar)",
      layer: "agent",
    }) as any;
    expect(r.error).toBe("invalid_layer");
  });

  it("prolog_retract removes term from disk and memory", async () => {
    await client.callTool("prolog_assert", {
      term: "retract_target(alpha)",
      layer: "session:e2e_retract",
    });
    await client.callTool("prolog_assert", {
      term: "retract_target(beta)",
      layer: "session:e2e_retract",
    });

    const before = await client.callTool("prolog_query", {
      goal: "retract_target(X)",
    }) as any;
    expect(before.solutions.length).toBe(2);

    const r = await client.callTool("prolog_retract", {
      term: "retract_target(alpha)",
      layer: "session:e2e_retract",
    }) as any;
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(1);

    const after = await client.callTool("prolog_query", {
      goal: "retract_target(alpha)",
    }) as any;
    expect(after.solutions).toEqual([]);

    const filePath = path.join(tmpDir, "sessions", "e2e_retract.pl");
    const contents = fs.readFileSync(filePath, "utf8");
    expect(contents).not.toContain("retract_target(alpha)");
    expect(contents).toContain("retract_target(beta)");
  });

  it("prolog_retract rejects bare layer without colon", async () => {
    const r = await client.callTool("prolog_retract", {
      term: "foo(bar)",
      layer: "session",
    }) as any;
    expect(r.error).toBe("invalid_layer");
  });

  it("prolog_list_facts with layer+functor returns only matching functor", async () => {
    await client.callTool("prolog_assert", {
      term: "list_alpha(1)",
      layer: "session:e2e_list",
    });
    await client.callTool("prolog_assert", {
      term: "list_alpha(2)",
      layer: "session:e2e_list",
    });
    await client.callTool("prolog_assert", {
      term: "list_beta(x)",
      layer: "session:e2e_list",
    });

    const r = await client.callTool("prolog_list_facts", {
      layer: "session:e2e_list",
      functor: "list_alpha",
    }) as any;
    expect(r.facts.every((f: string) => f.startsWith("list_alpha"))).toBe(true);
    expect(r.facts.some((f: string) => f.startsWith("list_beta"))).toBe(false);
  });

  it("prolog_write_file hot-reloads and makes facts queryable", async () => {
    const r = await client.callTool("prolog_write_file", {
      path: "scratch/e2e_written.pl",
      content: "written_fact(success).\n",
    }) as any;
    expect(r.ok).toBe(true);

    const q = await client.callTool("prolog_query", {
      goal: "written_fact(X)",
    }) as any;
    expect(q.solutions[0]?.X).toBe("success");
  });

  it("prolog_write_file returns syntax error and server stays alive", async () => {
    const r = await client.callTool("prolog_write_file", {
      path: "scratch/bad.pl",
      content: "broken :- .\n",
    }) as any;
    expect(r.error).toBeDefined();

    // Server still alive — subsequent query works
    const q = await client.callTool("prolog_query", { goal: "member(1,[1,2])" }) as any;
    expect(q.solutions.length).toBe(1);
  });
});

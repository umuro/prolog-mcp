// src/prolog-http.ts
import type {
  QueryResult, AssertResult, RetractResult,
  LoadFileResult, ResetLayerResult, ListFactsResult,
} from "./types.js";

export class PrologHttp {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`prolog-http ${endpoint}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  async health(): Promise<boolean> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(id);
    }
  }

  async query(goal: string, timeoutMs?: number): Promise<QueryResult> {
    return this.post("/query", { goal, timeout_ms: timeoutMs });
  }

  async assert(term: string, layer: string): Promise<AssertResult> {
    return this.post("/assert", { term, layer });
  }

  async retract(term: string, layer: string): Promise<RetractResult> {
    return this.post("/retract", { term, layer });
  }

  async retractFromFile(term: string, filePath: string): Promise<RetractResult> {
    return this.post("/retract_file", { term, path: filePath });
  }

  async loadFile(filePath: string): Promise<LoadFileResult> {
    return this.post("/load", { path: filePath });
  }

  async resetLayer(filePath: string, layer?: string): Promise<ResetLayerResult> {
    return this.post("/reset", { path: filePath, ...(layer ? { layer } : {}) });
  }

  async listFacts(opts: {
    layer?: string;
    functor?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListFactsResult> {
    return this.post("/list", opts);
  }
}

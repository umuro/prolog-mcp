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
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
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

  async loadFile(filePath: string): Promise<LoadFileResult> {
    return this.post("/load", { path: filePath });
  }

  async resetLayer(filePath: string): Promise<ResetLayerResult> {
    return this.post("/reset", { path: filePath });
  }

  async listFacts(opts: {
    functor?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListFactsResult> {
    return this.post("/list", opts);
  }
}

// src/types.ts
export type Config = {
  swiplPort: number;
  kbDir: string;
  defaultQueryTimeoutMs: number;
  maxFileSizeBytes: number;
  autoRestartSwipl: boolean;
  writeableLayers: string[];
};

export type PrologSolution = Record<string, string>;

export type QueryResult =
  | { solutions: PrologSolution[]; exhausted: boolean }
  | { error: "timeout"; partial: PrologSolution[] }
  | { error: string; detail?: string };

export type AssertResult   = { ok: true } | { error: string; detail?: string };
export type RetractResult  = { ok: true; removed: number } | { error: string; detail?: string };
export type WriteFileResult = { ok: true; clauses: number } | { error: string; detail?: string };
export type LoadFileResult  = { ok: true; clauses: number } | { error: string; detail?: string };
export type ListFactsResult = { facts: string[]; truncated: boolean } | { error: string };
export type ResetLayerResult = { ok: true; removed: number } | { error: string; detail?: string };

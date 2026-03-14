// src/term-codec.ts
export function goalToString(goal: string): string {
  if (!goal || goal.includes("\0")) {
    throw new Error("invalid_goal: empty or contains null bytes");
  }
  return goal;
}

export function termToString(term: string): string {
  if (!term || term.includes("\0")) {
    throw new Error("invalid_term: empty or contains null bytes");
  }
  return term;
}

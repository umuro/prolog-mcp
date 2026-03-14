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
  // Strip trailing period+whitespace — the caller always appends its own ".".
  // Prevents "foo(a).." double-period syntax errors when agents include the dot.
  return term.replace(/\.\s*$/, "");
}

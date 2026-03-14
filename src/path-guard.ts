// src/path-guard.ts
import path from "node:path";

export function guardPath(kbDir: string, userPath: string): string {
  if (path.isAbsolute(userPath)) {
    throw new Error("path_not_allowed: absolute paths are rejected");
  }
  const resolved = path.resolve(kbDir, userPath);
  const base = kbDir.endsWith(path.sep) ? kbDir : kbDir + path.sep;
  if (!resolved.startsWith(base) && resolved !== kbDir) {
    throw new Error("path_not_allowed: path resolves outside kbDir");
  }
  return resolved;
}

// test/path-guard.test.ts
import { describe, it, expect } from "vitest";
import { guardPath } from "../src/path-guard.js";

const kbDir = "/home/user/.local/share/prolog-mcp";

describe("guardPath", () => {
  it("allows a simple relative path", () => {
    expect(guardPath(kbDir, "scratch/foo.pl")).toBe(
      "/home/user/.local/share/prolog-mcp/scratch/foo.pl"
    );
  });

  it("allows a nested relative path", () => {
    expect(guardPath(kbDir, "agents/main.pl")).toBe(
      "/home/user/.local/share/prolog-mcp/agents/main.pl"
    );
  });

  it("rejects path traversal with ..", () => {
    expect(() => guardPath(kbDir, "../etc/passwd")).toThrow("path_not_allowed");
  });

  it("rejects absolute path", () => {
    expect(() => guardPath(kbDir, "/etc/passwd")).toThrow("path_not_allowed");
  });

  it("rejects encoded traversal", () => {
    expect(() => guardPath(kbDir, "scratch/../../etc/passwd")).toThrow("path_not_allowed");
  });

  it("rejects deeply nested escape", () => {
    expect(() => guardPath(kbDir, "scratch/../../../etc/passwd")).toThrow("path_not_allowed");
  });
});

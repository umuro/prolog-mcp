// test/term-codec.test.ts
import { describe, it, expect } from "vitest";
import { goalToString, termToString } from "../src/term-codec.js";

describe("goalToString", () => {
  it("passes valid goal through", () => {
    expect(goalToString("member(X, [1,2,3])")).toBe("member(X, [1,2,3])");
  });

  it("rejects empty string", () => {
    expect(() => goalToString("")).toThrow("invalid_goal");
  });

  it("rejects null bytes", () => {
    expect(() => goalToString("foo\0bar")).toThrow("invalid_goal");
  });
});

describe("termToString", () => {
  it("passes valid term", () => {
    expect(termToString("parent(tom, bob)")).toBe("parent(tom, bob)");
  });

  it("rejects empty string", () => {
    expect(() => termToString("")).toThrow("invalid_term");
  });

  it("rejects null bytes", () => {
    expect(() => termToString("foo\0bar")).toThrow("invalid_term");
  });
});

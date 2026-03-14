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

// -------------------------------------------------------------------
// goalToString — additional edge cases
// -------------------------------------------------------------------
describe("goalToString — additional edge cases", () => {
  it("passes whitespace-only string (not empty)", () => {
    // "  " is truthy and contains no null bytes — valid per current rules
    expect(goalToString("  member(X, [1])  ")).toBe("  member(X, [1])  ");
  });

  it("passes a single space (truthy, no null byte)", () => {
    expect(goalToString(" ")).toBe(" ");
  });

  it("passes unicode goal", () => {
    expect(goalToString("fact(héllo)")).toBe("fact(héllo)");
  });

  it("passes a very long goal string (10k chars)", () => {
    const long = "a".repeat(10_000);
    expect(goalToString(long)).toBe(long);
  });

  it("passes goal containing a period (valid Prolog)", () => {
    expect(goalToString("member(X, [1,2,3]).")).toBe("member(X, [1,2,3]).");
  });
});

// -------------------------------------------------------------------
// termToString — additional edge cases
// -------------------------------------------------------------------
describe("termToString — additional edge cases", () => {
  it("passes unicode term", () => {
    expect(termToString("résumé(X)")).toBe("résumé(X)");
  });

  it("passes a very long term string (10k chars)", () => {
    const long = "b".repeat(10_000);
    expect(termToString(long)).toBe(long);
  });

  it("passes term containing special Prolog chars (non-null)", () => {
    expect(termToString("f(X) :- g(X)")).toBe("f(X) :- g(X)");
  });
});

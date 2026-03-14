// test/server-health.test.ts
import { describe, it, expect } from "vitest";
import { ServerHealth } from "../src/server-health.js";

describe("ServerHealth.ensureRunning", () => {
  it("does not restart when healthy", async () => {
    let count = 0;
    const h = new ServerHealth({
      checkFn: async () => true,
      restartFn: async () => { count++; },
    });
    await h.ensureRunning();
    expect(count).toBe(0);
  });

  it("restarts exactly once across concurrent calls when unhealthy", async () => {
    let count = 0;
    const h = new ServerHealth({
      checkFn: async () => false,
      restartFn: async () => {
        count++;
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    await Promise.all(Array.from({ length: 5 }, () => h.ensureRunning()));
    expect(count).toBe(1);
  });

  it("allows restart again after previous restart completes", async () => {
    let count = 0;
    let healthy = false;
    const h = new ServerHealth({
      checkFn: async () => healthy,
      restartFn: async () => { count++; healthy = true; },
    });
    await h.ensureRunning();
    healthy = false;
    await h.ensureRunning();
    expect(count).toBe(2);
  });

  it("propagates restart errors to all waiting callers", async () => {
    const h = new ServerHealth({
      checkFn: async () => false,
      restartFn: async () => { throw new Error("start failed"); },
    });
    const results = await Promise.allSettled([h.ensureRunning(), h.ensureRunning()]);
    expect(results.every(r => r.status === "rejected")).toBe(true);
  });
});

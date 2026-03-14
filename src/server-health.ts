// src/server-health.ts
import { execFile } from "node:child_process";
import path from "node:path";

type HealthOptions = {
  checkFn: () => Promise<boolean>;
  restartFn: () => Promise<void>;
};

export class ServerHealth {
  private checkFn: () => Promise<boolean>;
  private restartFn: () => Promise<void>;
  private restartInProgress: Promise<void> | null = null;

  constructor(opts: HealthOptions) {
    this.checkFn = opts.checkFn;
    this.restartFn = opts.restartFn;
  }

  async ensureRunning(): Promise<void> {
    if (await this.checkFn()) return;
    if (this.restartInProgress) return this.restartInProgress;
    this.restartInProgress = this.restartFn().finally(() => {
      this.restartInProgress = null;
    });
    return this.restartInProgress;
  }
}

export function createServerHealth(opts: {
  port: number;
  kbDir: string;
  scriptDir: string;
  checkFn: () => Promise<boolean>;
}): ServerHealth {
  return new ServerHealth({
    checkFn: opts.checkFn,
    restartFn: () =>
      new Promise<void>((resolve, reject) => {
        // Use execFile (not exec) to prevent shell injection
        execFile(
          path.join(opts.scriptDir, "start.sh"),
          [],
          {
            env: {
              ...process.env,
              SWIPL_PORT: String(opts.port),
              KB_DIR: opts.kbDir,
            },
          },
          (err) => (err ? reject(err) : resolve())
        );
      }),
  });
}

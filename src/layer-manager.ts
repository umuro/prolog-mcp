// src/layer-manager.ts
import fs from "node:fs";
import path from "node:path";

type ResolveOptions = { write?: boolean };

export class LayerManager {
  private kbDir: string;
  private queues = new Map<string, Promise<void>>();

  constructor(kbDir: string) {
    this.kbDir = kbDir;
  }

  resolvePath(layer: string, opts: ResolveOptions = {}): string {
    if (layer === "core") {
      if (opts.write) throw new Error("layer_readonly: core is read-only at runtime");
      return path.join(this.kbDir, "core.pl");
    }
    if (layer.startsWith("agent:")) {
      return path.join(this.kbDir, "agents", `${layer.slice(6)}.pl`);
    }
    if (layer.startsWith("session:")) {
      return path.join(this.kbDir, "sessions", `${layer.slice(8)}.pl`);
    }
    if (layer === "scratch" || layer.startsWith("scratch:")) {
      const name = layer === "scratch" ? "scratch.pl" : `${layer.slice(8)}.pl`;
      return path.join(this.kbDir, "scratch", name);
    }
    throw new Error(`unknown_layer: ${layer}`);
  }

  async writeToLayer(layer: string, content: string): Promise<void> {
    const filePath = this.resolvePath(layer, { write: true });
    const prev = this.queues.get(layer) ?? Promise.resolve();
    const next = prev.then(() => fs.promises.writeFile(filePath, content, "utf8"));
    this.queues.set(layer, next.catch(() => {}));
    return next;
  }

  async appendToLayer(layer: string, line: string): Promise<void> {
    const filePath = this.resolvePath(layer, { write: true });
    const prev = this.queues.get(layer) ?? Promise.resolve();
    const next = prev.then(() =>
      fs.promises.appendFile(filePath, line + "\n", "utf8")
    );
    this.queues.set(layer, next.catch(() => {}));
    return next;
  }

  async deleteSessionLayer(layer: string): Promise<void> {
    if (!layer.startsWith("session:")) throw new Error("can only delete session layers");
    await fs.promises.rm(this.resolvePath(layer), { force: true });
  }
}

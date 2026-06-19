import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { findJsonlFiles, safeStat } from "./files.ts";
import { normalizeLine } from "./parser.ts";
import type { NormalizedEvent } from "./types.ts";

interface TailState {
  offset: number;
  lineCount: number;
  partial: string;
  threadId?: string;
}

export interface LiveTailerOptions {
  sessionsDir: string;
  statePath?: string;
  pollIntervalMs?: number;
}

export class LiveTailer {
  public readonly statePath: string;
  private readonly sessionsDir: string;
  private readonly pollIntervalMs: number;
  private readonly emitter = new EventEmitter();
  private readonly state = new Map<string, TailState>();
  private timer?: NodeJS.Timeout;

  constructor(options: LiveTailerOptions) {
    this.sessionsDir = options.sessionsDir;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.statePath = options.statePath ?? join(options.sessionsDir, ".codex-trace-live-state.json");
  }

  onEvent(listener: (event: NormalizedEvent) => void): void {
    this.emitter.on("event", listener);
  }

  async start(): Promise<void> {
    await this.loadState();
    const files = await findJsonlFiles(this.sessionsDir);
    for (const file of files) {
      const stats = await safeStat(file);
      if (!this.state.has(file)) {
        const summary = stats ? await inspectExistingFile(file) : { lineCount: 0, threadId: undefined };
        this.state.set(file, { offset: stats?.size ?? 0, lineCount: summary.lineCount, partial: "", threadId: summary.threadId });
        continue;
      }
      const current = this.state.get(file)!;
      if (stats && !current.threadId) {
        current.threadId = (await inspectExistingFile(file)).threadId;
      }
    }
    await this.persistState();
    this.timer = setInterval(() => {
      this.pollOnce().catch(() => undefined);
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.persistState();
  }

  async pollOnce(): Promise<NormalizedEvent[]> {
    const emitted: NormalizedEvent[] = [];
    const files = await findJsonlFiles(this.sessionsDir);
    for (const file of files) {
      const stats = await safeStat(file);
      if (!stats) continue;
      if (!this.state.has(file)) {
        this.state.set(file, { offset: 0, lineCount: 0, partial: "" });
      }
      const current = this.state.get(file)!;
      if (stats.size < current.offset) {
        current.offset = 0;
        current.lineCount = 0;
        current.partial = "";
        current.threadId = undefined;
      }
      if (stats.size <= current.offset) continue;
      const chunk = await readRange(file, current.offset, stats.size);
      current.offset = stats.size;
      const combined = current.partial + chunk;
      const parts = combined.split(/\n/);
      current.partial = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        current.lineCount += 1;
        current.threadId = threadIdFromLine(part) ?? current.threadId;
        const event = normalizeLine(part, current.lineCount, current.threadId);
        (event as any).filePath = file;
        emitted.push(event);
        this.emitter.emit("event", event);
      }
    }
    if (emitted.length > 0) await this.persistState();
    return emitted;
  }

  private async loadState(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.statePath, "utf8"));
      for (const [file, value] of Object.entries(raw)) {
        const entry: any = value;
        this.state.set(file, {
          offset: entry.offset ?? 0,
          lineCount: entry.lineCount ?? 0,
          partial: entry.partial ?? "",
          threadId: entry.threadId,
        });
      }
    } catch {
      this.state.clear();
    }
  }

  private async persistState(): Promise<void> {
    const raw: Record<string, TailState> = {};
    for (const [file, value] of this.state) raw[file] = value;
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(raw, null, 2));
  }
}

async function readRange(path: string, start: number, end: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(path, { start, end: end - 1 });
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function inspectExistingFile(path: string): Promise<{ lineCount: number; threadId?: string }> {
  const content = await readFile(path, "utf8");
  let lineCount = 0;
  let threadId: string | undefined;
  for (const line of content.split(/\n/)) {
    if (!line) continue;
    lineCount += 1;
    threadId = threadId ?? threadIdFromLine(line);
  }
  return { lineCount, threadId };
}

function threadIdFromLine(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line);
    const id = parsed?.type === "session_meta" ? parsed.payload?.id : undefined;
    return id ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

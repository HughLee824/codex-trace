import { readFile, stat } from "node:fs/promises";

import { findJsonlFiles, pathExists } from "./files.ts";
import { buildSessionModel } from "./parser.ts";
import type { TraceStore } from "./store.ts";

export interface IndexAllOptions {
  sessionsDir: string;
  sessionIndexPath?: string;
  store: TraceStore;
}

export async function indexAll(options: IndexAllOptions): Promise<{ indexed: number; skipped: number }> {
  await options.store.initialize();
  await options.store.clear();
  const threadNames = options.sessionIndexPath ? await loadThreadNames(options.sessionIndexPath) : new Map<string, string>();
  const files = await findJsonlFiles(options.sessionsDir);
  let indexed = 0;
  for (const file of files) {
    await indexFile({ file, store: options.store, threadNames });
    indexed += 1;
  }
  return { indexed, skipped: 0 };
}

export async function indexFile(options: { file: string; store: TraceStore; threadNames?: Map<string, string> }): Promise<void> {
  const content = await readFile(options.file, "utf8");
  const lines = content.split(/\n/).filter(Boolean);
  const model = buildSessionModel(options.file, lines);
  const stats = await stat(options.file);
  model.session.lineCount = lines.length;
  model.session.fileSize = stats.size;
  model.session.mtimeMs = stats.mtimeMs;
  model.session.updatedAt = model.session.updatedAt ?? stats.mtime.toISOString();
  if (options.threadNames?.has(model.session.threadId)) model.session.threadName = options.threadNames.get(model.session.threadId);
  await options.store.upsertModel(model);
}

async function loadThreadNames(path: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!(await pathExists(path))) return names;
  const lines = (await readFile(path, "utf8")).split(/\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.id && record.thread_name) names.set(record.id, record.thread_name);
    } catch {
      // Ignore malformed index rows; session JSONL remains authoritative.
    }
  }
  return names;
}

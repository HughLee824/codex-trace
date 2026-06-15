import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function findJsonlFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(path);
      }
    }
  }

  await walk(root);
  return results.sort();
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

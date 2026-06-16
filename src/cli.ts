#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "./doctor.ts";
import { indexAll, indexFile } from "./indexer.ts";
import { LiveTailer } from "./live.ts";
import { createTraceServer } from "./server.ts";
import { TraceStore } from "./store.ts";

interface RuntimeConfig {
  sessionsDir: string;
  sessionIndexPath: string;
  logsPath: string;
  traceHome: string;
  indexPath: string;
  liveStatePath: string;
  port: number;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  if (command === "version") {
    console.log(await readPackageVersion());
    return;
  }

  const config = readConfig(process.argv.slice(3));
  await mkdir(config.traceHome, { recursive: true });

  if (command === "doctor") {
    console.log(JSON.stringify(await runDoctor({ sessionsDir: config.sessionsDir, indexPath: config.indexPath, logsPath: config.logsPath }), null, 2));
    return;
  }

  const store = new TraceStore(config.indexPath);
  await store.initialize();

  if (command === "reindex") {
    const result = await indexAll({ sessionsDir: config.sessionsDir, sessionIndexPath: config.sessionIndexPath, store });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command !== "serve") {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
    return;
  }

  const result = await indexAll({ sessionsDir: config.sessionsDir, sessionIndexPath: config.sessionIndexPath, store });
  const app = createTraceServer({
    store,
    sessionsDir: config.sessionsDir,
    sessionIndexPath: config.sessionIndexPath,
    indexPath: config.indexPath,
    logsPath: config.logsPath,
  });
  const tailer = new LiveTailer({ sessionsDir: config.sessionsDir, statePath: config.liveStatePath, pollIntervalMs: 1000 });
  let reindexing = new Set<string>();
  tailer.onEvent((event: any) => {
    app.broadcastEvent(event);
    if (event.filePath && !reindexing.has(event.filePath)) {
      reindexing.add(event.filePath);
      setTimeout(async () => {
        try {
          await indexFile({ file: event.filePath, store });
          app.broadcast("session.updated", { filePath: event.filePath });
        } catch (error: any) {
          app.broadcast("index.error", { filePath: event.filePath, error: error.message });
        } finally {
          reindexing.delete(event.filePath);
        }
      }, 100);
    }
  });
  await tailer.start();
  await app.listen(config.port);
  console.log(`codex-trace indexed ${result.indexed} sessions`);
  console.log(`codex-trace running at http://127.0.0.1:${config.port}`);
}

function readConfig(args: string[]): RuntimeConfig {
  const home = homedir();
  const traceHome = readFlag(args, "--trace-home") ?? join(home, ".codex-trace");
  return {
    sessionsDir: readFlag(args, "--sessions") ?? join(home, ".codex", "sessions"),
    sessionIndexPath: readFlag(args, "--session-index") ?? join(home, ".codex", "session_index.jsonl"),
    logsPath: readFlag(args, "--logs") ?? join(home, ".codex", "logs_2.sqlite"),
    traceHome,
    indexPath: readFlag(args, "--index") ?? join(traceHome, "index.sqlite"),
    liveStatePath: readFlag(args, "--live-state") ?? join(traceHome, "live-state.json"),
    port: Number(readFlag(args, "--port") ?? "17345"),
  };
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

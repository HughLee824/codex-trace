import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { indexAll, indexFile, refreshThreadNames } from "../src/indexer.ts";
import { TraceStore } from "../src/store.ts";

test("indexes sessions into sqlite and exposes timeline, tools, subagents, and raw events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-index-"));
  const sessionsDir = join(dir, "sessions");
  const dayDir = join(sessionsDir, "2026", "06", "14");
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dir, "session_index.jsonl"), `${JSON.stringify({ id: "parent-1", thread_name: "Parent", updated_at: "2026-06-14T00:00:09.000Z" })}\n`);
  await writeFile(join(dayDir, "rollout-2026-06-14T00-00-00-parent-1.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "parent-1", cwd: "/work", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.000Z", type: "event_msg", payload: { type: "user_message", message: "hello token=secret" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "spawn_agent", call_id: "spawn-1", arguments: "{\"agent_type\":\"worker\"}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "spawn-1", output: "{\"agent_id\":\"child-1\",\"nickname\":\"Curie\"}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:04.500Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5, total_tokens: 130 }, last_token_usage: { input_tokens: 90, cached_input_tokens: 10, output_tokens: 30, reasoning_output_tokens: 5, total_tokens: 120 }, model_context_window: 1000 } } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:05.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "done" } }),
  ].join("\n") + "\n");
  await writeFile(join(dayDir, "rollout-2026-06-14T00-01-00-child-1.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:01:00.000Z", type: "session_meta", payload: { id: "child-1", cwd: "/work", thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: "parent-1", agent_nickname: "Curie", agent_role: "worker", depth: 1 } } } } }),
    JSON.stringify({ timestamp: "2026-06-14T00:01:01.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 70, reasoning_output_tokens: 10, total_tokens: 270 }, last_token_usage: { input_tokens: 160, cached_input_tokens: 40, output_tokens: 70, reasoning_output_tokens: 10, total_tokens: 230 }, model_context_window: 800 } } }),
  ].join("\n") + "\n");
  await writeFile(join(dayDir, "rollout-2026-06-14T00-02-00-grandchild-1.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:02:00.000Z", type: "session_meta", payload: { id: "grandchild-1", cwd: "/work", thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: "child-1", agent_nickname: "Hopper", agent_role: "worker", depth: 2 } } } } }),
    JSON.stringify({ timestamp: "2026-06-14T00:02:01.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 2, total_tokens: 70 }, last_token_usage: { input_tokens: 40, cached_input_tokens: 8, output_tokens: 20, reasoning_output_tokens: 2, total_tokens: 60 }, model_context_window: 800 } } }),
  ].join("\n") + "\n");

  const store = new TraceStore(join(dir, "index.sqlite"));
  await store.initialize();
  await indexAll({ sessionsDir, sessionIndexPath: join(dir, "session_index.jsonl"), store });

  const sessions = await store.listSessions({ q: "Parent" });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].threadName, "Parent");

  const timeline = await store.getTimeline("parent-1");
  assert.equal(timeline.turns[0].userMessage, "hello token=[REDACTED]");
  assert.equal(timeline.tools[0].name, "spawn_agent");

  const subagents = await store.getSubagents("parent-1");
  assert.equal(subagents.some((edge) => edge.childThreadId === "child-1"), true);

  const raw = await store.getRawEvent(timeline.events[0].id!);
  assert.match(raw.rawJson, /session_meta/);

  const usage = await store.getUsageStats("parent-1");
  assert.equal(usage.total.inputTokens, 350);
  assert.equal(usage.total.cachedInputTokens, 80);
  assert.equal(usage.total.outputTokens, 120);
  assert.equal(usage.total.reasoningOutputTokens, 17);
  assert.equal(usage.agents.length, 3);
  assert.deepEqual(usage.agents.map((agent) => agent.kind), ["lead", "subagent", "subagent"]);
  assert.equal(usage.agents[0].threadId, "parent-1");
  assert.equal(usage.agents[1].threadId, "child-1");
  assert.equal(usage.agents[1].contextWindow, 800);
  assert.equal(usage.agents[1].contextUsedTokens, 160);
  assert.equal(usage.agents[2].threadId, "grandchild-1");
  assert.equal(usage.current.threadId, "parent-1");
  assert.equal(usage.current.contextUsedTokens, 90);

  const childUsage = await store.getUsageStats("child-1");
  assert.equal(childUsage.total.inputTokens, 250);
  assert.equal(childUsage.current.threadId, "child-1");
  assert.equal(childUsage.current.contextUsedTokens, 160);
});

test("sqlite writes wait for transient index locks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-lock-"));
  const dbPath = join(dir, "index.sqlite");
  const store = new TraceStore(dbPath);
  await store.initialize();

  const lock = holdSqliteWriteLock(dbPath);
  await waitForSqliteLock(dbPath);

  await store.clear();
  await lock;
});

test("sqlite child processes time out instead of blocking the server indefinitely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-sqlite-timeout-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const sqlitePath = join(binDir, "sqlite3");
  await writeFile(sqlitePath, "#!/bin/sh\nsleep 5\n");
  await chmod(sqlitePath, 0o755);

  const previousPath = process.env.PATH;
  const previousTimeout = process.env.CODEX_TRACE_SQLITE_PROCESS_TIMEOUT_MS;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  process.env.CODEX_TRACE_SQLITE_PROCESS_TIMEOUT_MS = "100";
  try {
    const store = new TraceStore(join(dir, "index.sqlite"));
    const startedAt = Date.now();

    await assert.rejects(
      store.listSessions(),
      /sqlite3 timed out after 100ms/,
    );
    assert.ok(Date.now() - startedAt < 1500);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousTimeout === undefined) delete process.env.CODEX_TRACE_SQLITE_PROCESS_TIMEOUT_MS;
    else process.env.CODEX_TRACE_SQLITE_PROCESS_TIMEOUT_MS = previousTimeout;
  }
});

test("refreshes thread names from session index without rebuilding sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-thread-name-"));
  const sessionsDir = join(dir, "sessions");
  const dayDir = join(sessionsDir, "2026", "06", "14");
  const sessionIndexPath = join(dir, "session_index.jsonl");
  await mkdir(dayDir, { recursive: true });
  await writeFile(sessionIndexPath, "");
  await writeFile(join(dayDir, "rollout-2026-06-14T00-00-00-thread-1.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1", cwd: "/work", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "hello" } }),
  ].join("\n") + "\n");

  const store = new TraceStore(join(dir, "index.sqlite"));
  await store.initialize();
  await indexAll({ sessionsDir, sessionIndexPath, store });
  assert.equal((await store.getSession("thread-1"))?.threadName ?? undefined, undefined);

  await writeFile(sessionIndexPath, `${JSON.stringify({ id: "thread-1", thread_name: "Delayed title", updated_at: "2026-06-14T00:00:09.000Z" })}\n`);
  const changed = await refreshThreadNames({ sessionIndexPath, store });

  assert.deepEqual(changed.map((session) => session.threadId), ["thread-1"]);
  assert.equal(changed[0].filePath.endsWith("rollout-2026-06-14T00-00-00-thread-1.jsonl"), true);
  assert.equal((await store.getSession("thread-1"))?.threadName, "Delayed title");
  assert.equal((await store.getTimeline("thread-1")).messages.length, 1);
});

test("lists sessions by latest activity time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-active-sort-"));
  const sessionsDir = join(dir, "sessions");
  const dayDir = join(sessionsDir, "2026", "06", "14");
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, "rollout-2026-06-14T00-00-00-thread-old-active.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-old-active", cwd: "/work", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:10:00.000Z", type: "event_msg", payload: { type: "agent_message", message: "later", phase: "commentary" } }),
  ].join("\n") + "\n");
  await writeFile(join(dayDir, "rollout-2026-06-14T00-05-00-thread-new-idle.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:05:00.000Z", type: "session_meta", payload: { id: "thread-new-idle", cwd: "/work", thread_source: "user" } }),
  ].join("\n") + "\n");

  const store = new TraceStore(join(dir, "index.sqlite"));
  await store.initialize();
  await indexAll({ sessionsDir, store });

  const sessions = await store.listSessions();
  assert.equal(sessions[0].threadId, "thread-old-active");
  assert.equal(sessions[0].updatedAt, "2026-06-14T00:10:00.000Z");
});

test("live file reindex preserves delayed thread names when using a stale name snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-thread-name-race-"));
  const sessionsDir = join(dir, "sessions");
  const dayDir = join(sessionsDir, "2026", "06", "14");
  const sessionIndexPath = join(dir, "session_index.jsonl");
  const sessionPath = join(dayDir, "rollout-2026-06-14T00-00-00-thread-1.jsonl");
  await mkdir(dayDir, { recursive: true });
  await writeFile(sessionIndexPath, "");
  await writeFile(sessionPath, [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1", cwd: "/work", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "hello" } }),
  ].join("\n") + "\n");

  const store = new TraceStore(join(dir, "index.sqlite"));
  await store.initialize();
  await indexAll({ sessionsDir, sessionIndexPath, store });
  const staleThreadNames = new Map<string, string>();

  await writeFile(sessionIndexPath, `${JSON.stringify({ id: "thread-1", thread_name: "Delayed title", updated_at: "2026-06-14T00:00:09.000Z" })}\n`);
  await refreshThreadNames({ sessionIndexPath, store });
  await indexFile({ file: sessionPath, store, threadNames: staleThreadNames });

  assert.equal((await store.getSession("thread-1"))?.threadName, "Delayed title");
});

test("full reindex fails clearly when another rebuild is active", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-rebuild-lock-"));
  const sessionsDir = join(dir, "sessions");
  const dbPath = join(dir, "index.sqlite");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(`${dbPath}.rebuild.lock`);

  let initializeCalled = false;
  const store = {
    dbPath,
    initialize: async () => {
      initializeCalled = true;
      throw new Error("initialize should not run while rebuild is locked");
    },
  } as unknown as TraceStore;
  await assert.rejects(
    indexAll({ sessionsDir, store }),
    /codex-trace index rebuild already running[\s\S]*\.rebuild\.lock/,
  );
  assert.equal(initializeCalled, false);
});

function holdSqliteWriteLock(dbPath: string): Promise<void> {
  const child = spawn("python3", ["-c", `
import sqlite3
import sys
import time

connection = sqlite3.connect(sys.argv[1])
connection.execute("BEGIN EXCLUSIVE")
connection.execute("CREATE TABLE IF NOT EXISTS lock_holder (id INTEGER)")
connection.execute("INSERT INTO lock_holder VALUES (1)")
time.sleep(1)
connection.commit()
connection.close()
`, dbPath], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `sqlite3 exited ${code}`)));
  });
}

async function waitForSqliteLock(dbPath: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync("sqlite3", ["-cmd", "PRAGMA busy_timeout=0;", dbPath], {
      input: "BEGIN IMMEDIATE;\nROLLBACK;",
      encoding: "utf8",
    });
    if (result.status !== 0 && /database is locked/.test(result.stderr)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("sqlite write lock was not acquired");
}

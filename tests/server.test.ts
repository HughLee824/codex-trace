import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { indexAll } from "../src/indexer.ts";
import { createTraceServer } from "../src/server.ts";
import { TraceStore } from "../src/store.ts";

test("HTTP API serves sessions, timeline, tools, subagents, raw events, and doctor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-server-"));
  const sessionsDir = join(dir, "sessions", "2026", "06", "14");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, "rollout-2026-06-14T00-00-00-thread-1.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1", cwd: "/work", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.000Z", type: "event_msg", payload: { type: "user_message", message: "hello" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\"cmd\":\"pwd\"}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:04.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5, total_tokens: 130 }, last_token_usage: { input_tokens: 90, cached_input_tokens: 10, output_tokens: 30, reasoning_output_tokens: 5, total_tokens: 120 }, model_context_window: 1000 } } }),
  ].join("\n") + "\n");

  const rootSessionsDir = join(dir, "sessions");
  const store = new TraceStore(join(dir, "index.sqlite"));
  await store.initialize();
  await indexAll({ sessionsDir: rootSessionsDir, store });

  const app = createTraceServer({
    store,
    sessionsDir: rootSessionsDir,
    indexPath: join(dir, "index.sqlite"),
    logsPath: join(dir, "logs_2.sqlite"),
  });
  await app.listen(0);
  try {
    const address = app.server.address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${(address as any).port}`;

    const sessions = await fetchJson(`${base}/api/sessions`);
    assert.equal(sessions[0].threadId, "thread-1");

    const timeline = await fetchJson(`${base}/api/sessions/thread-1/timeline`);
    assert.equal(timeline.turns[0].userMessage, "hello");
    assert.equal(timeline.tools[0].name, "exec_command");

    const tools = await fetchJson(`${base}/api/sessions/thread-1/tools`);
    assert.equal(tools[0].callId, "call-1");

    const subagents = await fetchJson(`${base}/api/sessions/thread-1/subagents`);
    assert.deepEqual(subagents, []);

    const usage = await fetchJson(`${base}/api/sessions/thread-1/usage`);
    assert.equal(usage.total.inputTokens, 100);
    assert.equal(usage.agents[0].contextUsedTokens, 90);

    const raw = await fetchJson(`${base}/api/events/${timeline.events[0].id}/raw`);
    assert.match(raw.rawJson, /session_meta/);

    const doctor = await fetchJson(`${base}/api/doctor`);
    assert.equal(doctor.sessions.status, "ok");
  } finally {
    await app.close();
  }
});

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (response.status !== 200) assert.fail(await response.text());
  return await response.json();
}

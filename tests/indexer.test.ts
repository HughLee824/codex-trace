import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { indexAll } from "../src/indexer.ts";
import { TraceStore } from "../src/store.ts";

test("indexes sessions into sqlite and exposes timeline, tools, subagents, and raw events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-index-"));
  const sessionsDir = join(dir, "sessions");
  const dayDir = join(sessionsDir, "2026", "06", "14");
  await import("node:fs/promises").then((fs) => fs.mkdir(dayDir, { recursive: true }));
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

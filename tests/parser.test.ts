import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionModel, normalizeLine } from "../src/parser.ts";

test("normalizes user, assistant, tool, exec, patch, and turn events", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1", cwd: "/work", source: "vscode", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-1", started_at: 1780000000 } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.000Z", type: "event_msg", payload: { type: "user_message", message: "hello", images: [] } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:03.000Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "working" }] } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:04.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\"cmd\":\"false\",\"workdir\":\"/work\"}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:05.000Z", type: "event_msg", payload: { type: "exec_command_end", call_id: "call-1", turn_id: "turn-1", cwd: "/work", stdout: "", stderr: "nope", exit_code: 1, duration: { secs: 0, nanos: 5 } } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:06.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "call-2", input: "*** Begin Patch\n*** End Patch\n" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:07.000Z", type: "event_msg", payload: { type: "patch_apply_end", call_id: "call-2", turn_id: "turn-1", success: true, changes: { "a.ts": { type: "update", unified_diff: "@@" } } } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:08.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1", completed_at: 1780000010, duration_ms: 1000, last_agent_message: "done" } }),
  ];

  const model = buildSessionModel("/tmp/rollout.jsonl", lines);

  assert.equal(model.session.threadId, "thread-1");
  assert.equal(model.turns[0].userMessage, "hello");
  assert.equal(model.turns[0].lastAgentMessage, "done");
  assert.equal(model.messages.find((m) => m.eventType === "message.assistant.commentary")?.text, "working");

  const exec = model.toolCalls.find((call) => call.callId === "call-1");
  assert.equal(exec?.name, "exec_command");
  assert.equal(exec?.exitCode, 1);
  assert.equal(exec?.stderr, "nope");

  const patch = model.toolCalls.find((call) => call.callId === "call-2");
  assert.equal(patch?.kind, "custom");
  assert.equal(patch?.patchSuccess, true);
  assert.deepEqual(patch?.changedFiles, ["a.ts"]);
});

test("normalizeLine marks unknown or invalid input without throwing", () => {
  assert.equal(normalizeLine("{bad", 1, "thread-x").eventType, "raw.unknown");
  assert.equal(normalizeLine(JSON.stringify({ type: "compacted", payload: {} }), 2, "thread-x").eventType, "context.compacted");
});

test("buildSessionModel creates a fallback turn when task_started has no turn id", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.000Z", type: "event_msg", payload: { type: "task_complete", duration_ms: 1000 } }),
  ];

  const model = buildSessionModel("/tmp/rollout.jsonl", lines);

  assert.equal(model.turns[0].turnId, "turn-1");
  assert.equal(model.turns[0].status, "completed");
});

test("buildSessionModel deduplicates event stream echoes from visible messages", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "hello" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "working", phase: "commentary" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.010Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "working" }] } }),
  ];

  const model = buildSessionModel("/tmp/rollout.jsonl", lines);

  assert.equal(model.events.length, 5);
  assert.deepEqual(model.messages.map((message) => message.text), ["hello", "working"]);
  assert.deepEqual(model.messages.map((message) => message.source), ["response_item", "response_item"]);
});

test("buildSessionModel records latest token and context usage", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-1", model_context_window: 200000 } }),
    JSON.stringify({
      timestamp: "2026-06-14T00:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1200,
            cached_input_tokens: 800,
            output_tokens: 90,
            reasoning_output_tokens: 20,
            total_tokens: 1290,
          },
          last_token_usage: {
            input_tokens: 900,
            cached_input_tokens: 700,
            output_tokens: 40,
            reasoning_output_tokens: 10,
            total_tokens: 940,
          },
          model_context_window: 200000,
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-14T00:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1800,
            cached_input_tokens: 900,
            output_tokens: 120,
            reasoning_output_tokens: 25,
            total_tokens: 1920,
          },
          last_token_usage: {
            input_tokens: 1100,
            cached_input_tokens: 100,
            output_tokens: 30,
            reasoning_output_tokens: 5,
            total_tokens: 1130,
          },
          model_context_window: 200000,
        },
      },
    }),
  ];

  const model = buildSessionModel("/tmp/rollout.jsonl", lines);

  assert.deepEqual(model.usage, {
    threadId: "thread-1",
    inputTokens: 1800,
    cachedInputTokens: 900,
    outputTokens: 120,
    reasoningOutputTokens: 25,
    totalTokens: 1920,
    lastInputTokens: 1100,
    lastCachedInputTokens: 100,
    lastOutputTokens: 30,
    lastReasoningOutputTokens: 5,
    lastTotalTokens: 1130,
    contextWindow: 200000,
    contextUsedTokens: 1100,
    updatedAt: "2026-06-14T00:00:03.000Z",
  });
});

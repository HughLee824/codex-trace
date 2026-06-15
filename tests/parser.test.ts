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

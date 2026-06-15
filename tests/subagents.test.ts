import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionModel } from "../src/parser.ts";

test("builds subagent edges from child session metadata", () => {
  const model = buildSessionModel("/tmp/child.jsonl", [
    JSON.stringify({
      timestamp: "2026-06-14T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "child-1",
        cwd: "/work",
        thread_source: "subagent",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "parent-1",
              depth: 1,
              agent_nickname: "Noether",
              agent_role: "worker"
            }
          }
        }
      }
    })
  ]);

  assert.equal(model.session.parentThreadId, "parent-1");
  assert.equal(model.session.agentNickname, "Noether");
  assert.equal(model.subagentEdges[0].parentThreadId, "parent-1");
  assert.equal(model.subagentEdges[0].childThreadId, "child-1");
  assert.equal(model.subagentEdges[0].role, "worker");
});

test("extracts spawn, wait, close, and unlinked guardian subagents", () => {
  const parent = buildSessionModel("/tmp/parent.jsonl", [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "parent-1", cwd: "/work", thread_source: "user" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:01.000Z", type: "response_item", payload: { type: "function_call", name: "spawn_agent", call_id: "spawn-1", arguments: "{\"agent_type\":\"worker\",\"message\":\"do work\"}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:02.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "spawn-1", output: "{\"agent_id\":\"child-1\",\"nickname\":\"Curie\"}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "wait_agent", call_id: "wait-1", arguments: "{\"targets\":[\"child-1\"],\"timeout_ms\":1}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "wait-1", output: "{\"status\":{\"child-1\":{\"completed\":\"done\"}},\"timed_out\":false}" } }),
    JSON.stringify({ timestamp: "2026-06-14T00:00:05.000Z", type: "response_item", payload: { type: "function_call", name: "close_agent", call_id: "close-1", arguments: "{\"target\":\"child-1\"}" } }),
  ]);
  const guardian = buildSessionModel("/tmp/guardian.jsonl", [
    JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "guardian-1", thread_source: "subagent", source: { subagent: { other: "guardian" } } } }),
  ]);

  const spawn = parent.subagentEvents.find((event) => event.eventType === "subagent.spawn");
  const wait = parent.subagentEvents.find((event) => event.eventType === "subagent.wait");
  const close = parent.subagentEvents.find((event) => event.eventType === "subagent.close");

  assert.equal(spawn?.agentId, "child-1");
  assert.equal(spawn?.nickname, "Curie");
  assert.equal(wait?.statusSummary, "completed: done");
  assert.equal(close?.agentId, "child-1");
  assert.equal(guardian.session.unlinkedSubagentKind, "guardian");
});

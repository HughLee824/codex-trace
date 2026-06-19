import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LiveTailer } from "../src/live.ts";

test("LiveTailer emits only appended complete JSONL events and tolerates partial lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-live-"));
  const file = join(dir, "rollout-2026-06-14T00-00-00-thread-1.jsonl");
  await writeFile(file, `${JSON.stringify({ timestamp: "2026-06-14T00:00:00.000Z", type: "session_meta", payload: { id: "thread-1" } })}\n`);

  const events: any[] = [];
  const tailer = new LiveTailer({ sessionsDir: dir, pollIntervalMs: 60_000 });
  tailer.onEvent((event) => events.push(event));
  await tailer.start();

  try {
    await appendFile(file, "{\"timestamp\":\"2026-06-14T00:00:01.000Z\"");
    await tailer.pollOnce();
    assert.deepEqual(events, []);

    await appendFile(file, ",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}\n");
    await tailer.pollOnce();
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "message.user");
    assert.equal(events[0].threadId, "thread-1");

    const offsets = JSON.parse(await readFile(tailer.statePath, "utf8"));
    assert.equal(offsets[file].lineCount, 2);
    assert.equal(offsets[file].threadId, "thread-1");
  } finally {
    await tailer.stop();
  }
});

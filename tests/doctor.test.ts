import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDoctor } from "../src/doctor.ts";

test("doctor reports sessions, index, and logs status without requiring logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-doctor-"));
  const report = await runDoctor({
    sessionsDir: dir,
    indexPath: join(dir, "missing", "index.sqlite"),
    logsPath: join(dir, "missing-logs.sqlite"),
  });

  assert.equal(report.sessions.status, "ok");
  assert.equal(report.sessions.fileCount, 0);
  assert.equal(report.index.status, "missing");
  assert.equal(report.logs.status, "warning");
});

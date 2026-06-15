import { access } from "node:fs/promises";

import { findJsonlFiles, pathExists } from "./files.ts";

export interface DoctorOptions {
  sessionsDir: string;
  indexPath: string;
  logsPath: string;
}

export async function runDoctor(options: DoctorOptions) {
  const report = {
    sessions: { status: "missing", path: options.sessionsDir, fileCount: 0, message: "" },
    index: { status: "missing", path: options.indexPath, message: "" },
    logs: { status: "warning", path: options.logsPath, message: "" },
  };

  try {
    await access(options.sessionsDir);
    const files = await findJsonlFiles(options.sessionsDir);
    report.sessions.status = "ok";
    report.sessions.fileCount = files.length;
    report.sessions.message = files.length === 0 ? "sessions directory is readable but contains no JSONL files" : "sessions directory is readable";
  } catch (error: any) {
    report.sessions.status = "error";
    report.sessions.message = error.message;
  }

  if (await pathExists(options.indexPath)) {
    report.index.status = "ok";
    report.index.message = "index exists";
  } else {
    report.index.status = "missing";
    report.index.message = "index does not exist; run reindex or start serve";
  }

  if (await pathExists(options.logsPath)) {
    report.logs.status = "ok";
    report.logs.message = "logs database exists";
  } else {
    report.logs.status = "warning";
    report.logs.message = "logs database is unavailable; main JSONL timeline still works";
  }

  return report;
}

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

import type { AgentUsageRecord, SessionModel, SessionRecord, SubagentEdge, TokenUsageRecord, ToolCallRecord, UsageStats } from "./types.ts";

const SQLITE_BUSY_TIMEOUT_MS = 10_000;
const DEFAULT_SQLITE_PROCESS_TIMEOUT_MS = 30_000;

function q(value: unknown): string {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function json(value: unknown): string {
  return q(JSON.stringify(value ?? null));
}

function bool(value: unknown): string {
  if (value === undefined || value === null) return "NULL";
  return value ? "1" : "0";
}

export class TraceStore {
  public readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        thread_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        started_at TEXT,
        updated_at TEXT,
        cwd TEXT,
        thread_name TEXT,
        source TEXT,
        thread_source TEXT,
        originator TEXT,
        cli_version TEXT,
        parent_thread_id TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        unlinked_subagent_kind TEXT,
        line_count INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER,
        mtime_ms REAL
      );
      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT,
        thread_id TEXT,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        user_message TEXT,
        last_agent_message TEXT,
        status TEXT,
        PRIMARY KEY (thread_id, turn_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        line_no INTEGER NOT NULL,
        timestamp TEXT,
        top_type TEXT,
        event_type TEXT,
        role TEXT,
        phase TEXT,
        raw_json TEXT NOT NULL,
        text_preview TEXT,
        call_id TEXT,
        tool_name TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        role TEXT,
        phase TEXT,
        source TEXT,
        event_type TEXT,
        text TEXT,
        line_no INTEGER,
        timestamp TEXT
      );
      CREATE TABLE IF NOT EXISTS tool_calls (
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        call_id TEXT NOT NULL,
        name TEXT,
        kind TEXT,
        arguments TEXT,
        output TEXT,
        status TEXT,
        cwd TEXT,
        stdout TEXT,
        stderr TEXT,
        exit_code INTEGER,
        duration_ms INTEGER,
        started_line INTEGER,
        output_line INTEGER,
        patch_success INTEGER,
        changed_files TEXT,
        PRIMARY KEY (thread_id, call_id)
      );
      CREATE TABLE IF NOT EXISTS session_usage (
        thread_id TEXT PRIMARY KEY,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        last_input_tokens INTEGER NOT NULL DEFAULT 0,
        last_cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        last_output_tokens INTEGER NOT NULL DEFAULT 0,
        last_reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        last_total_tokens INTEGER NOT NULL DEFAULT 0,
        context_window INTEGER,
        context_used_tokens INTEGER,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS subagent_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_thread_id TEXT,
        child_thread_id TEXT,
        agent_id TEXT,
        nickname TEXT,
        role TEXT,
        depth INTEGER,
        spawn_call_id TEXT,
        status_summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_thread_line ON events(thread_id, line_no);
      CREATE INDEX IF NOT EXISTS idx_tools_thread ON tool_calls(thread_id);
      CREATE INDEX IF NOT EXISTS idx_edges_parent ON subagent_edges(parent_thread_id);
    `);
  }

  async clear(): Promise<void> {
    this.exec(`
      DELETE FROM subagent_edges;
      DELETE FROM session_usage;
      DELETE FROM tool_calls;
      DELETE FROM messages;
      DELETE FROM events;
      DELETE FROM turns;
      DELETE FROM sessions;
    `);
  }

  async upsertModel(model: SessionModel): Promise<void> {
    const s = model.session;
    const statements: string[] = [
      "BEGIN;",
      `DELETE FROM subagent_edges WHERE parent_thread_id = ${q(s.threadId)} OR child_thread_id = ${q(s.threadId)};`,
      `DELETE FROM tool_calls WHERE thread_id = ${q(s.threadId)};`,
      `DELETE FROM session_usage WHERE thread_id = ${q(s.threadId)};`,
      `DELETE FROM messages WHERE thread_id = ${q(s.threadId)};`,
      `DELETE FROM events WHERE thread_id = ${q(s.threadId)};`,
      `DELETE FROM turns WHERE thread_id = ${q(s.threadId)};`,
      `DELETE FROM sessions WHERE thread_id = ${q(s.threadId)};`,
      `INSERT INTO sessions (
        thread_id, file_path, started_at, updated_at, cwd, thread_name, source, thread_source,
        originator, cli_version, parent_thread_id, agent_nickname, agent_role, unlinked_subagent_kind,
        line_count, file_size, mtime_ms
      ) VALUES (
        ${q(s.threadId)}, ${q(s.filePath)}, ${q(s.startedAt)}, ${q(s.updatedAt)}, ${q(s.cwd)}, ${q(s.threadName)},
        ${q(s.source)}, ${q(s.threadSource)}, ${q(s.originator)}, ${q(s.cliVersion)}, ${q(s.parentThreadId)},
        ${q(s.agentNickname)}, ${q(s.agentRole)}, ${q(s.unlinkedSubagentKind)}, ${q(s.lineCount)}, ${q(s.fileSize)}, ${q(s.mtimeMs)}
      );`,
    ];

    for (const turn of model.turns) {
      statements.push(`INSERT INTO turns VALUES (${q(turn.turnId)}, ${q(s.threadId)}, ${q(turn.startedAt)}, ${q(turn.completedAt)}, ${q(turn.durationMs)}, ${q(turn.userMessage)}, ${q(turn.lastAgentMessage)}, ${q(turn.status)});`);
    }
    for (const event of model.events) {
      statements.push(`INSERT INTO events (thread_id, turn_id, line_no, timestamp, top_type, event_type, role, phase, raw_json, text_preview, call_id, tool_name)
        VALUES (${q(s.threadId)}, ${q(event.turnId)}, ${q(event.lineNo)}, ${q(event.timestamp)}, ${q(event.topType)}, ${q(event.eventType)}, ${q(event.role)}, ${q(event.phase)}, ${q(event.rawJson)}, ${q(event.textPreview)}, ${q(event.callId)}, ${q(event.toolName)});`);
    }
    for (const message of model.messages) {
      statements.push(`INSERT INTO messages (thread_id, turn_id, role, phase, source, event_type, text, line_no, timestamp)
        VALUES (${q(s.threadId)}, ${q(message.turnId)}, ${q(message.role)}, ${q(message.phase)}, ${q(message.source)}, ${q(message.eventType)}, ${q(message.text)}, ${q(message.lineNo)}, ${q(message.timestamp)});`);
    }
    if (model.usage) statements.push(this.insertUsageSql(model.usage));
    for (const call of model.toolCalls) statements.push(this.insertToolSql(call));
    for (const edge of model.subagentEdges) statements.push(this.insertEdgeSql(edge));
    statements.push("COMMIT;");
    this.exec(statements.join("\n"));
  }

  async updateThreadNames(threadNames: Map<string, string>): Promise<SessionRecord[]> {
    if (threadNames.size === 0) return [];
    const existing = this.query(`SELECT thread_id AS threadId, file_path AS filePath, thread_name AS threadName FROM sessions WHERE thread_id IN (${Array.from(threadNames.keys()).map(q).join(", ")});`) as SessionRecord[];
    const changed = existing.filter((session) => {
      const nextName = threadNames.get(session.threadId);
      return nextName !== undefined && nextName !== session.threadName;
    });
    if (changed.length === 0) return [];

    this.exec([
      "BEGIN;",
      ...changed.map((session) => `UPDATE sessions SET thread_name = ${q(threadNames.get(session.threadId))} WHERE thread_id = ${q(session.threadId)};`),
      "COMMIT;",
    ].join("\n"));
    return changed.map((session) => ({ ...session, threadName: threadNames.get(session.threadId) }));
  }

  async listSessions(filters: { active?: string; cwd?: string; source?: string; q?: string } = {}): Promise<SessionRecord[]> {
    const where: string[] = [];
    if (filters.cwd) where.push(`cwd LIKE ${q(`%${filters.cwd}%`)}`);
    if (filters.source) where.push(`thread_source = ${q(filters.source)}`);
    if (filters.q) {
      const needle = q(`%${filters.q}%`);
      where.push(`(thread_name LIKE ${needle} OR cwd LIKE ${needle} OR thread_id LIKE ${needle})`);
    }
    const rows = this.query(`SELECT
      thread_id AS threadId, file_path AS filePath, started_at AS startedAt, updated_at AS updatedAt,
      cwd, thread_name AS threadName, source, thread_source AS threadSource, originator,
      cli_version AS cliVersion, parent_thread_id AS parentThreadId, agent_nickname AS agentNickname,
      agent_role AS agentRole, unlinked_subagent_kind AS unlinkedSubagentKind, line_count AS lineCount,
      file_size AS fileSize, mtime_ms AS mtimeMs
      FROM sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(updated_at, started_at) DESC LIMIT 500;`);
    return rows as SessionRecord[];
  }

  async getSession(threadId: string): Promise<SessionRecord | undefined> {
    return (this.query(`SELECT thread_id AS threadId, file_path AS filePath, started_at AS startedAt, updated_at AS updatedAt, cwd, thread_name AS threadName, source, thread_source AS threadSource, parent_thread_id AS parentThreadId, agent_nickname AS agentNickname, agent_role AS agentRole, line_count AS lineCount, file_size AS fileSize, mtime_ms AS mtimeMs FROM sessions WHERE thread_id = ${q(threadId)} LIMIT 1;`) as SessionRecord[])[0];
  }

  async getTimeline(threadId: string) {
    return {
      session: await this.getSession(threadId),
      turns: this.query(`SELECT turn_id AS turnId, thread_id AS threadId, started_at AS startedAt, completed_at AS completedAt, duration_ms AS durationMs, user_message AS userMessage, last_agent_message AS lastAgentMessage, status FROM turns WHERE thread_id = ${q(threadId)} ORDER BY COALESCE(started_at, turn_id);`),
      events: this.query(`SELECT id, thread_id AS threadId, turn_id AS turnId, line_no AS lineNo, timestamp, top_type AS topType, event_type AS eventType, role, phase, text_preview AS textPreview, call_id AS callId, tool_name AS toolName FROM events WHERE thread_id = ${q(threadId)} ORDER BY line_no;`),
      messages: this.query(`SELECT thread_id AS threadId, turn_id AS turnId, role, phase, source, event_type AS eventType, text, line_no AS lineNo, timestamp FROM messages WHERE thread_id = ${q(threadId)} ORDER BY line_no;`),
      tools: await this.getTools(threadId),
    };
  }

  async getTools(threadId: string): Promise<ToolCallRecord[]> {
    return this.query(`SELECT thread_id AS threadId, turn_id AS turnId, call_id AS callId, name, kind, arguments, output, status, cwd, stdout, stderr, exit_code AS exitCode, duration_ms AS durationMs, started_line AS startedLine, output_line AS outputLine, patch_success AS patchSuccess, changed_files AS changedFiles FROM tool_calls WHERE thread_id = ${q(threadId)} ORDER BY started_line;`).map((row: any) => ({
      ...row,
      patchSuccess: row.patchSuccess === null || row.patchSuccess === undefined ? undefined : Boolean(row.patchSuccess),
      changedFiles: row.changedFiles ? JSON.parse(row.changedFiles) : undefined,
    }));
  }

  async getSubagents(threadId: string): Promise<SubagentEdge[]> {
    return this.query(`SELECT parent_thread_id AS parentThreadId, child_thread_id AS childThreadId, agent_id AS agentId, nickname, role, depth, spawn_call_id AS spawnCallId, status_summary AS statusSummary FROM subagent_edges WHERE parent_thread_id = ${q(threadId)} OR child_thread_id = ${q(threadId)} ORDER BY id;`) as SubagentEdge[];
  }

  async getUsageStats(threadId: string): Promise<UsageStats> {
    const session = await this.getSession(threadId);
    const childEdges = await this.getDescendantEdges(threadId);
    const childIds = unique(childEdges.map((edge) => edge.childThreadId!).filter(Boolean));
    const ids = unique([threadId, ...childIds]);
    const usageByThread = new Map((await this.getUsageRows(ids)).map((row) => [row.threadId, row]));
    const sessionByThread = new Map((await this.getSessionsByIds(ids)).map((record) => [record.threadId, record]));

    const agents: AgentUsageRecord[] = [];
    const current: AgentUsageRecord = {
      ...zeroUsage(threadId),
      ...usageByThread.get(threadId),
      kind: "lead",
      label: session?.agentNickname || session?.threadName || "Lead agent",
      role: session?.agentRole,
    };
    agents.push(current);

    for (const edge of childEdges) {
      const childId = edge.childThreadId!;
      const childSession = sessionByThread.get(childId);
      agents.push({
        ...zeroUsage(childId),
        ...usageByThread.get(childId),
        kind: "subagent",
        label: edge.nickname || childSession?.agentNickname || shortId(childId),
        role: edge.role || childSession?.agentRole,
      });
    }

    return {
      threadId,
      total: sumUsage(threadId, agents),
      current,
      agents,
    };
  }

  async getRawEvent(eventId: number): Promise<{ id: number; rawJson: string }> {
    const row = this.query(`SELECT id, raw_json AS rawJson FROM events WHERE id = ${q(eventId)} LIMIT 1;`)[0];
    if (!row) throw new Error(`event not found: ${eventId}`);
    return row;
  }

  private insertToolSql(call: ToolCallRecord): string {
    return `INSERT INTO tool_calls VALUES (${q(call.threadId)}, ${q(call.turnId)}, ${q(call.callId)}, ${q(call.name)}, ${q(call.kind)}, ${q(call.arguments)}, ${q(call.output)}, ${q(call.status)}, ${q(call.cwd)}, ${q(call.stdout)}, ${q(call.stderr)}, ${q(call.exitCode)}, ${q(call.durationMs)}, ${q(call.startedLine)}, ${q(call.outputLine)}, ${bool(call.patchSuccess)}, ${json(call.changedFiles)});`;
  }

  private insertUsageSql(usage: TokenUsageRecord): string {
    return `INSERT INTO session_usage VALUES (
      ${q(usage.threadId)}, ${q(usage.inputTokens)}, ${q(usage.cachedInputTokens)}, ${q(usage.outputTokens)},
      ${q(usage.reasoningOutputTokens)}, ${q(usage.totalTokens)}, ${q(usage.lastInputTokens)},
      ${q(usage.lastCachedInputTokens)}, ${q(usage.lastOutputTokens)}, ${q(usage.lastReasoningOutputTokens)},
      ${q(usage.lastTotalTokens)}, ${q(usage.contextWindow)}, ${q(usage.contextUsedTokens)}, ${q(usage.updatedAt)}
    );`;
  }

  private insertEdgeSql(edge: SubagentEdge): string {
    return `INSERT INTO subagent_edges (parent_thread_id, child_thread_id, agent_id, nickname, role, depth, spawn_call_id, status_summary)
      VALUES (${q(edge.parentThreadId)}, ${q(edge.childThreadId)}, ${q(edge.agentId)}, ${q(edge.nickname)}, ${q(edge.role)}, ${q(edge.depth)}, ${q(edge.spawnCallId)}, ${q(edge.statusSummary)});`;
  }

  private async getUsageRows(threadIds: string[]): Promise<TokenUsageRecord[]> {
    if (!threadIds.length) return [];
    const rows = this.query(`SELECT
      thread_id AS threadId,
      input_tokens AS inputTokens,
      cached_input_tokens AS cachedInputTokens,
      output_tokens AS outputTokens,
      reasoning_output_tokens AS reasoningOutputTokens,
      total_tokens AS totalTokens,
      last_input_tokens AS lastInputTokens,
      last_cached_input_tokens AS lastCachedInputTokens,
      last_output_tokens AS lastOutputTokens,
      last_reasoning_output_tokens AS lastReasoningOutputTokens,
      last_total_tokens AS lastTotalTokens,
      context_window AS contextWindow,
      context_used_tokens AS contextUsedTokens,
      updated_at AS updatedAt
      FROM session_usage WHERE thread_id IN (${threadIds.map(q).join(", ")});`) as TokenUsageRecord[];
    return rows.map((row) => ({ ...zeroUsage(row.threadId), ...row }));
  }

  private async getSessionsByIds(threadIds: string[]): Promise<SessionRecord[]> {
    if (!threadIds.length) return [];
    return this.query(`SELECT thread_id AS threadId, file_path AS filePath, thread_name AS threadName, parent_thread_id AS parentThreadId, agent_nickname AS agentNickname, agent_role AS agentRole, line_count AS lineCount FROM sessions WHERE thread_id IN (${threadIds.map(q).join(", ")});`) as SessionRecord[];
  }

  private async getDescendantEdges(threadId: string): Promise<SubagentEdge[]> {
    const rows = this.query(`SELECT parent_thread_id AS parentThreadId, child_thread_id AS childThreadId, agent_id AS agentId, nickname, role, depth, spawn_call_id AS spawnCallId, status_summary AS statusSummary FROM subagent_edges ORDER BY id;`) as SubagentEdge[];
    const result: SubagentEdge[] = [];
    const seen = new Set<string>();
    const queue = [threadId];
    while (queue.length) {
      const parent = queue.shift()!;
      for (const edge of rows) {
        if (edge.parentThreadId !== parent || !edge.childThreadId || seen.has(edge.childThreadId)) continue;
        seen.add(edge.childThreadId);
        result.push(edge);
        queue.push(edge.childThreadId);
      }
    }
    return result;
  }

  private exec(sql: string): void {
    const result = spawnSync("sqlite3", this.sqliteArgs(), this.sqliteSpawnOptions(sql));
    if (result.status !== 0) throw this.sqliteError(result);
  }

  private query(sql: string): any[] {
    const result = spawnSync("sqlite3", this.sqliteArgs("-json"), this.sqliteSpawnOptions(sql));
    if (result.status !== 0) throw this.sqliteError(result);
    const text = result.stdout.toString().trim();
    return text ? JSON.parse(text) : [];
  }

  private sqliteSpawnOptions(sql: string): Parameters<typeof spawnSync>[2] {
    return {
      input: sql,
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
      timeout: sqliteProcessTimeoutMs(),
    };
  }

  private sqliteArgs(...extra: string[]): string[] {
    return [
      ...extra,
      "-bail",
      "-cmd",
      `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`,
      this.dbPath,
    ];
  }

  private sqliteError(result: ReturnType<typeof spawnSync>): Error {
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    if (timedOut) {
      return new Error(`sqlite3 timed out after ${sqliteProcessTimeoutMs()}ms for ${this.dbPath}`);
    }
    const message = result.stderr?.toString() || result.stdout?.toString() || `sqlite3 exited ${result.status}`;
    if (/database is locked/.test(message)) {
      return new Error([
        `codex-trace index database is locked: ${this.dbPath}`,
        "Another codex-trace serve/reindex process may be writing to the same index.",
        "Stop the other process or use --trace-home/--index for a separate index.",
        message.trim(),
      ].join("\n"));
    }
    return new Error(message);
  }
}

function sqliteProcessTimeoutMs(): number {
  const configured = Number(process.env.CODEX_TRACE_SQLITE_PROCESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SQLITE_PROCESS_TIMEOUT_MS;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function zeroUsage(threadId: string): TokenUsageRecord {
  return {
    threadId,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    lastInputTokens: 0,
    lastCachedInputTokens: 0,
    lastOutputTokens: 0,
    lastReasoningOutputTokens: 0,
    lastTotalTokens: 0,
  };
}

function sumUsage(threadId: string, agents: AgentUsageRecord[]): TokenUsageRecord {
  const total = zeroUsage(threadId);
  for (const agent of agents) {
    total.inputTokens += agent.inputTokens;
    total.cachedInputTokens += agent.cachedInputTokens;
    total.outputTokens += agent.outputTokens;
    total.reasoningOutputTokens += agent.reasoningOutputTokens;
    total.totalTokens += agent.totalTokens;
    total.lastInputTokens += agent.lastInputTokens;
    total.lastCachedInputTokens += agent.lastCachedInputTokens;
    total.lastOutputTokens += agent.lastOutputTokens;
    total.lastReasoningOutputTokens += agent.lastReasoningOutputTokens;
    total.lastTotalTokens += agent.lastTotalTokens;
    total.contextWindow = (total.contextWindow ?? 0) + (agent.contextWindow ?? 0);
    total.contextUsedTokens = (total.contextUsedTokens ?? 0) + (agent.contextUsedTokens ?? 0);
    if (!total.updatedAt || (agent.updatedAt && agent.updatedAt > total.updatedAt)) total.updatedAt = agent.updatedAt;
  }
  if (total.contextWindow === 0) total.contextWindow = undefined;
  if (total.contextUsedTokens === 0) total.contextUsedTokens = undefined;
  return total;
}

function shortId(value: string): string {
  return value.length > 13 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

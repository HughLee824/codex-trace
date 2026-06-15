export type NormalizedEventType =
  | "message.user"
  | "message.assistant.commentary"
  | "message.assistant.final"
  | "tool.call"
  | "tool.output"
  | "tool.exec.end"
  | "tool.patch.end"
  | "subagent.spawn"
  | "subagent.wait"
  | "subagent.close"
  | "turn.started"
  | "turn.completed"
  | "context.compacted"
  | "raw.unknown";

export interface SessionRecord {
  threadId: string;
  filePath: string;
  startedAt?: string;
  updatedAt?: string;
  cwd?: string;
  threadName?: string;
  source?: string;
  threadSource?: string;
  originator?: string;
  cliVersion?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  unlinkedSubagentKind?: string;
  lineCount: number;
  fileSize?: number;
  mtimeMs?: number;
}

export interface TurnRecord {
  turnId: string;
  threadId: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  userMessage?: string;
  lastAgentMessage?: string;
  status?: string;
}

export interface NormalizedEvent {
  id?: number;
  threadId: string;
  turnId?: string;
  lineNo: number;
  timestamp?: string;
  topType: string;
  eventType: NormalizedEventType;
  role?: string;
  phase?: string;
  rawJson: string;
  text?: string;
  textPreview?: string;
  callId?: string;
  toolName?: string;
}

export interface MessageRecord {
  threadId: string;
  turnId?: string;
  role: string;
  phase?: string;
  source: string;
  eventType: NormalizedEventType;
  text: string;
  lineNo: number;
  timestamp?: string;
}

export interface ToolCallRecord {
  threadId: string;
  turnId?: string;
  callId: string;
  name: string;
  kind: "function" | "custom" | "web" | "tool_search" | "image";
  arguments?: string;
  output?: string;
  status?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  startedLine: number;
  outputLine?: number;
  patchSuccess?: boolean;
  changedFiles?: string[];
}

export interface SubagentEdge {
  parentThreadId?: string;
  childThreadId?: string;
  agentId?: string;
  nickname?: string;
  role?: string;
  depth?: number;
  spawnCallId?: string;
  statusSummary?: string;
}

export interface SubagentEvent extends SubagentEdge {
  threadId: string;
  eventType: "subagent.spawn" | "subagent.wait" | "subagent.close";
  callId: string;
  lineNo: number;
  timestamp?: string;
}

export interface SessionModel {
  session: SessionRecord;
  turns: TurnRecord[];
  events: NormalizedEvent[];
  messages: MessageRecord[];
  toolCalls: ToolCallRecord[];
  subagentEdges: SubagentEdge[];
  subagentEvents: SubagentEvent[];
}

import { basename } from "node:path";

import { isSensitiveModelInput, preview, redactText } from "./redact.ts";
import type {
  MessageRecord,
  NormalizedEvent,
  SessionModel,
  SessionRecord,
  SubagentEdge,
  SubagentEvent,
  TokenUsageRecord,
  ToolCallRecord,
  TurnRecord,
} from "./types.ts";

function safeJson(text: string): any | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringifySource(source: unknown): string | undefined {
  if (source === undefined || source === null) return undefined;
  return typeof source === "string" ? source : JSON.stringify(source);
}

function inferThreadId(filePath: string): string {
  const match = basename(filePath).match(/rollout-[^-]+(?:-[^-]+)*-([0-9a-f]{8,}-[0-9a-f-]+)\.jsonl$/i);
  return match?.[1] ?? basename(filePath).replace(/\.jsonl$/, "");
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: any) => item?.text ?? item?.input_text ?? item?.output_text ?? "")
    .filter(Boolean)
    .join("\n");
}

function durationToMs(duration: any): number | undefined {
  if (!duration) return undefined;
  if (typeof duration === "number") return duration;
  if (typeof duration.secs === "number" || typeof duration.nanos === "number") {
    return Math.round((duration.secs ?? 0) * 1000 + (duration.nanos ?? 0) / 1_000_000);
  }
  return undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readTokenUsage(source: any) {
  return {
    inputTokens: numberValue(source?.input_tokens ?? source?.inputTokens),
    cachedInputTokens: numberValue(source?.cached_input_tokens ?? source?.cachedInputTokens ?? source?.input_tokens_details?.cached_tokens),
    outputTokens: numberValue(source?.output_tokens ?? source?.outputTokens),
    reasoningOutputTokens: numberValue(source?.reasoning_output_tokens ?? source?.reasoningOutputTokens ?? source?.output_tokens_details?.reasoning_tokens),
    totalTokens: numberValue(source?.total_tokens ?? source?.totalTokens),
  };
}

function extractTokenUsage(payload: any, threadId: string, timestamp?: string): TokenUsageRecord | undefined {
  const info = payload?.info ?? payload;
  const totalSource = info?.total_token_usage ?? info?.totalTokenUsage ?? payload?.usage;
  const lastSource = info?.last_token_usage ?? info?.lastTokenUsage ?? totalSource;
  if (!totalSource && !lastSource && !info?.model_context_window && !payload?.model_context_window) return undefined;

  const total = readTokenUsage(totalSource);
  const last = readTokenUsage(lastSource);
  const contextWindow = numberValue(info?.model_context_window ?? payload?.model_context_window) || undefined;
  const contextUsedTokens = last.inputTokens || undefined;

  return {
    threadId,
    ...total,
    lastInputTokens: last.inputTokens,
    lastCachedInputTokens: last.cachedInputTokens,
    lastOutputTokens: last.outputTokens,
    lastReasoningOutputTokens: last.reasoningOutputTokens,
    lastTotalTokens: last.totalTokens,
    contextWindow,
    contextUsedTokens,
    updatedAt: timestamp,
  };
}

function summarizeWaitOutput(output: string | undefined): string | undefined {
  const parsed = output ? safeJson(output) : undefined;
  if (!parsed?.status) return output ? preview(output, 180) : undefined;
  const pieces: string[] = [];
  for (const [agentId, status] of Object.entries(parsed.status)) {
    const value: any = status;
    if (value.completed) pieces.push(`completed: ${preview(value.completed, 120)}`);
    else if (value.failed) pieces.push(`failed: ${preview(value.failed, 120)}`);
    else pieces.push(`${agentId}: ${preview(value, 120)}`);
  }
  if (parsed.timed_out) pieces.push("timed out");
  return pieces.join("; ");
}

function parseToolArguments(payload: any): string | undefined {
  if (payload.arguments !== undefined) return String(payload.arguments);
  if (payload.input !== undefined) return String(payload.input);
  if (payload.action !== undefined) return JSON.stringify(payload.action);
  return undefined;
}

function extractToolName(payload: any): string {
  if (payload.name) return payload.name;
  if (payload.type === "web_search_call") return "web_search";
  if (payload.type === "tool_search_call") return "tool_search";
  if (payload.type === "image_generation_call") return "image_generation";
  return payload.type ?? "unknown_tool";
}

function toolKind(payload: any): ToolCallRecord["kind"] {
  if (payload.type === "custom_tool_call") return "custom";
  if (payload.type === "web_search_call") return "web";
  if (payload.type === "tool_search_call") return "tool_search";
  if (payload.type === "image_generation_call") return "image";
  return "function";
}

export function normalizeLine(line: string, lineNo: number, fallbackThreadId = "unknown"): NormalizedEvent {
  const parsed = safeJson(line);
  if (!parsed) {
    return {
      threadId: fallbackThreadId,
      lineNo,
      topType: "invalid",
      eventType: "raw.unknown",
      rawJson: line,
      textPreview: preview(line),
    };
  }
  const payload = parsed.payload ?? {};
  let eventType: NormalizedEvent["eventType"] = "raw.unknown";
  let text = "";
  let role = payload.role;
  let phase = payload.phase;
  let callId = payload.call_id ?? payload.callId;
  let toolName = payload.name ?? payload.tool;

  if (parsed.type === "compacted" || payload.type === "context_compacted") eventType = "context.compacted";
  if (parsed.type === "event_msg" && payload.type === "user_message") {
    eventType = "message.user";
    text = payload.message ?? "";
    role = "user";
  }
  if (parsed.type === "event_msg" && payload.type === "agent_message") {
    eventType = payload.phase === "final_answer" ? "message.assistant.final" : "message.assistant.commentary";
    text = payload.message ?? "";
    role = "assistant";
    phase = payload.phase;
  }
  if (parsed.type === "event_msg" && payload.type === "task_started") eventType = "turn.started";
  if (parsed.type === "event_msg" && payload.type === "task_complete") eventType = "turn.completed";
  if (parsed.type === "event_msg" && payload.type === "exec_command_end") {
    eventType = "tool.exec.end";
    toolName = "exec_command";
  }
  if (parsed.type === "event_msg" && payload.type === "patch_apply_end") {
    eventType = "tool.patch.end";
    toolName = "apply_patch";
  }
  if (parsed.type === "response_item" && payload.type === "message") {
    text = contentText(payload.content);
    role = payload.role;
    if (payload.role === "user") eventType = "message.user";
    if (payload.role === "assistant") eventType = payload.phase === "final_answer" ? "message.assistant.final" : "message.assistant.commentary";
  }
  if (parsed.type === "response_item" && ["function_call", "custom_tool_call", "web_search_call", "tool_search_call", "image_generation_call"].includes(payload.type)) {
    eventType = "tool.call";
    toolName = extractToolName(payload);
    callId = payload.call_id ?? payload.id;
  }
  if (parsed.type === "response_item" && ["function_call_output", "custom_tool_call_output", "tool_search_output"].includes(payload.type)) {
    eventType = "tool.output";
    callId = payload.call_id;
  }

  return {
    threadId: fallbackThreadId,
    turnId: payload.turn_id ?? payload.turnId,
    lineNo,
    timestamp: parsed.timestamp,
    topType: parsed.type ?? "unknown",
    eventType,
    role,
    phase,
    rawJson: line,
    text,
    textPreview: preview(text || payload.message || payload.output || line),
    callId,
    toolName,
  };
}

export function buildSessionModel(filePath: string, lines: string[]): SessionModel {
  const fallbackThreadId = inferThreadId(filePath);
  const session: SessionRecord = {
    threadId: fallbackThreadId,
    filePath,
    lineCount: lines.length,
  };
  const turns = new Map<string, TurnRecord>();
  const events: NormalizedEvent[] = [];
  const messages: MessageRecord[] = [];
  const toolCalls = new Map<string, ToolCallRecord>();
  const subagentEdges: SubagentEdge[] = [];
  const subagentEvents: SubagentEvent[] = [];
  let usage: TokenUsageRecord | undefined;
  let currentTurnId: string | undefined;

  function getTurn(turnId: string): TurnRecord {
    const existing = turns.get(turnId);
    if (existing) return existing;
    const created: TurnRecord = { turnId, threadId: session.threadId };
    turns.set(turnId, created);
    return created;
  }

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const line = lines[index];
    if (!line.trim()) continue;
    const parsed = safeJson(line);
    const payload = parsed?.payload ?? {};

    if (parsed?.type === "session_meta") {
      session.threadId = payload.id ?? session.threadId;
      session.startedAt = parsed.timestamp ?? payload.timestamp;
      session.updatedAt = parsed.timestamp ?? payload.timestamp;
      session.cwd = payload.cwd;
      session.source = stringifySource(payload.source);
      session.threadSource = payload.thread_source;
      session.originator = payload.originator;
      session.cliVersion = payload.cli_version;
      const spawn = payload.source?.subagent?.thread_spawn;
      if (spawn) {
        session.parentThreadId = spawn.parent_thread_id;
        session.agentNickname = spawn.agent_nickname;
        session.agentRole = spawn.agent_role;
        subagentEdges.push({
          parentThreadId: spawn.parent_thread_id,
          childThreadId: session.threadId,
          nickname: spawn.agent_nickname,
          role: spawn.agent_role,
          depth: spawn.depth,
        });
      } else if (payload.source?.subagent?.other) {
        session.unlinkedSubagentKind = payload.source.subagent.other;
      }
    }
    if (parsed?.timestamp && (!session.updatedAt || parsed.timestamp > session.updatedAt)) {
      session.updatedAt = parsed.timestamp;
    }

    const event = normalizeLine(line, lineNo, session.threadId);
    if (event.turnId) currentTurnId = event.turnId;
    if (!event.turnId && currentTurnId) event.turnId = currentTurnId;
    event.threadId = session.threadId;
    events.push(event);

    if (event.eventType === "turn.started") {
      const turnId = String(payload.turn_id ?? currentTurnId ?? `turn-${lineNo}`);
      currentTurnId = turnId;
      const turn = getTurn(turnId);
      turn.startedAt = parsed.timestamp ?? (payload.started_at ? new Date(payload.started_at * 1000).toISOString() : undefined);
      turn.status = "running";
    }
    if (event.eventType === "turn.completed") {
      const turnId = payload.turn_id ?? currentTurnId ?? `turn-${lineNo}`;
      const turn = getTurn(turnId);
      turn.completedAt = parsed.timestamp ?? (payload.completed_at ? new Date(payload.completed_at * 1000).toISOString() : undefined);
      turn.durationMs = payload.duration_ms;
      turn.lastAgentMessage = payload.last_agent_message;
      turn.status = "completed";
    }
    if (event.eventType === "message.user" || event.eventType === "message.assistant.commentary" || event.eventType === "message.assistant.final") {
      const text = event.text ?? "";
      if (text && !(event.role !== "assistant" && isSensitiveModelInput(event.role, text))) {
        const source = parsed?.type === "event_msg" ? "event_msg" : "response_item";
        const message = {
          threadId: session.threadId,
          turnId: event.turnId,
          role: event.role ?? "unknown",
          phase: event.phase,
          source,
          eventType: event.eventType,
          text: redactText(text),
          lineNo,
          timestamp: event.timestamp,
        };
        const echoIndex = messages.findIndex((existing) => isMessageEcho(existing, message));
        if (echoIndex === -1) {
          messages.push(message);
        } else if (source === "response_item" && messages[echoIndex].source === "event_msg") {
          messages[echoIndex] = message;
        }
      }
      if (event.eventType === "message.user" && event.turnId) {
        const turn = getTurn(event.turnId);
        if (!turn.userMessage) turn.userMessage = redactText(text);
      }
    }

    if (parsed?.type === "response_item" && event.eventType === "tool.call") {
      const callId = payload.call_id ?? payload.id ?? `call-${lineNo}`;
      const call: ToolCallRecord = {
        threadId: session.threadId,
        turnId: event.turnId,
        callId,
        name: extractToolName(payload),
        kind: toolKind(payload),
        arguments: parseToolArguments(payload),
        status: payload.status,
        startedLine: lineNo,
      };
      toolCalls.set(callId, call);
      if (call.name === "close_agent") {
        const args = safeJson(call.arguments ?? "{}");
        subagentEvents.push({
          threadId: session.threadId,
          eventType: "subagent.close",
          callId,
          lineNo,
          timestamp: parsed.timestamp,
          agentId: args?.target,
        });
      }
    }

    if (parsed?.type === "response_item" && event.eventType === "tool.output") {
      const call = toolCalls.get(payload.call_id);
      if (call) {
        call.output = payload.output ?? JSON.stringify(payload);
        call.outputLine = lineNo;
        if (call.name === "spawn_agent") {
          const output = safeJson(call.output ?? "");
          const args = safeJson(call.arguments ?? "{}");
          const subEvent: SubagentEvent = {
            threadId: session.threadId,
            eventType: "subagent.spawn",
            callId: call.callId,
            lineNo,
            timestamp: parsed.timestamp,
            parentThreadId: session.threadId,
            agentId: output?.agent_id,
            childThreadId: output?.agent_id,
            nickname: output?.nickname,
            role: args?.agent_type,
            spawnCallId: call.callId,
          };
          subagentEvents.push(subEvent);
          subagentEdges.push(subEvent);
        }
        if (call.name === "wait_agent") {
          const args = safeJson(call.arguments ?? "{}");
          const output = safeJson(call.output ?? "");
          subagentEvents.push({
            threadId: session.threadId,
            eventType: "subagent.wait",
            callId: call.callId,
            lineNo,
            timestamp: parsed.timestamp,
            agentId: args?.targets?.[0],
            statusSummary: summarizeWaitOutput(call.output),
          });
          if (output?.status) {
            for (const agentId of Object.keys(output.status)) {
              const edge = subagentEdges.find((candidate) => candidate.agentId === agentId || candidate.childThreadId === agentId);
              if (edge) edge.statusSummary = summarizeWaitOutput(JSON.stringify({ status: { [agentId]: output.status[agentId] }, timed_out: output.timed_out }));
            }
          }
        }
      }
    }

    if (parsed?.type === "event_msg" && payload.type === "exec_command_end") {
      const call = toolCalls.get(payload.call_id);
      if (call) {
        call.cwd = payload.cwd;
        call.stdout = payload.stdout;
        call.stderr = payload.stderr;
        call.output = payload.aggregated_output ?? payload.formatted_output ?? [payload.stdout, payload.stderr].filter(Boolean).join("\n");
        call.exitCode = payload.exit_code;
        call.durationMs = durationToMs(payload.duration);
        call.status = payload.status;
        call.outputLine = lineNo;
      }
    }

    if (parsed?.type === "event_msg" && payload.type === "patch_apply_end") {
      const call = toolCalls.get(payload.call_id);
      if (call) {
        call.patchSuccess = payload.success;
        call.changedFiles = Object.keys(payload.changes ?? {});
        call.output = payload.stdout ?? "";
        call.stderr = payload.stderr;
        call.status = payload.status;
        call.outputLine = lineNo;
      }
    }

    if (parsed?.type === "event_msg" && payload.type === "token_count") {
      usage = extractTokenUsage(payload, session.threadId, parsed.timestamp) ?? usage;
    } else if (payload?.usage) {
      usage = extractTokenUsage(payload, session.threadId, parsed?.timestamp) ?? usage;
    }
  }

  return {
    session,
    turns: Array.from(turns.values()),
    events,
    messages,
    toolCalls: Array.from(toolCalls.values()),
    subagentEdges,
    subagentEvents,
    usage,
  };
}

function isMessageEcho(existing: MessageRecord, incoming: MessageRecord): boolean {
  if (existing.source === incoming.source) return false;
  if (existing.role !== incoming.role) return false;
  if ((existing.phase ?? "") !== (incoming.phase ?? "")) return false;
  if (existing.eventType !== incoming.eventType) return false;
  if (existing.text !== incoming.text) return false;
  if (!existing.timestamp || !incoming.timestamp) return false;
  const existingTime = Date.parse(existing.timestamp);
  const incomingTime = Date.parse(incoming.timestamp);
  if (Number.isNaN(existingTime) || Number.isNaN(incomingTime)) return false;
  return Math.abs(existingTime - incomingTime) <= 2000;
}

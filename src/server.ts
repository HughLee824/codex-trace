import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "./doctor.ts";
import { indexAll } from "./indexer.ts";
import type { TraceStore } from "./store.ts";
import type { NormalizedEvent } from "./types.ts";

export interface TraceServerOptions {
  store: TraceStore;
  sessionsDir: string;
  sessionIndexPath?: string;
  indexPath: string;
  logsPath: string;
  publicDir?: string;
}

export function createTraceServer(options: TraceServerOptions) {
  const clients = new Set<ServerResponse>();
  const publicDir = options.publicDir ?? fileURLToPath(new URL("../public", import.meta.url));

  const server = createServer(async (request, response) => {
    try {
      await route(request, response, options, publicDir, clients);
    } catch (error: any) {
      sendJson(response, 500, { error: error.message ?? String(error) });
    }
  });

  return {
    server,
    listen(port: number, host = "127.0.0.1") {
      return new Promise<void>((resolve) => server.listen(port, host, resolve));
    },
    close() {
      server.closeAllConnections?.();
      return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
    broadcast(type: string, payload: unknown) {
      const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) client.write(message);
    },
    broadcastEvent(event: NormalizedEvent) {
      const type = liveTypeFor(event.eventType);
      this.broadcast(type, event);
      this.broadcast("event.appended", event);
    },
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: TraceServerOptions,
  publicDir: string,
  clients: Set<ServerResponse>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/live") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (pathname === "/api/sessions") {
    sendJson(response, 200, await options.store.listSessions({
      active: url.searchParams.get("active") ?? undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    }));
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const session = await options.store.getSession(sessionMatch[1]);
    sendJson(response, session ? 200 : 404, session ?? { error: "session not found" });
    return;
  }

  const timelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/);
  if (timelineMatch) {
    sendJson(response, 200, await options.store.getTimeline(timelineMatch[1]));
    return;
  }

  const toolsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/tools$/);
  if (toolsMatch) {
    sendJson(response, 200, await options.store.getTools(toolsMatch[1]));
    return;
  }

  const subagentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/subagents$/);
  if (subagentsMatch) {
    sendJson(response, 200, await options.store.getSubagents(subagentsMatch[1]));
    return;
  }

  const rawMatch = pathname.match(/^\/api\/events\/(\d+)\/raw$/);
  if (rawMatch) {
    sendJson(response, 200, await options.store.getRawEvent(Number(rawMatch[1])));
    return;
  }

  if (pathname === "/api/doctor") {
    sendJson(response, 200, await runDoctor({ sessionsDir: options.sessionsDir, indexPath: options.indexPath, logsPath: options.logsPath }));
    return;
  }

  if (pathname === "/api/index/rebuild" && request.method === "POST") {
    const result = await indexAll({ sessionsDir: options.sessionsDir, sessionIndexPath: options.sessionIndexPath, store: options.store });
    sendJson(response, 200, result);
    return;
  }

  await serveStatic(pathname, response, publicDir);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(pathname: string, response: ServerResponse, publicDir: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safeRelative = relative.includes("..") ? "index.html" : relative;
  const file = join(publicDir, safeRelative);
  try {
    const content = await readFile(file);
    response.writeHead(200, { "Content-Type": contentType(file) });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function contentType(file: string): string {
  switch (extname(file)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function liveTypeFor(eventType: string): string {
  if (eventType === "turn.started") return "turn.started";
  if (eventType === "tool.call") return "tool.started";
  if (eventType === "tool.output" || eventType === "tool.exec.end" || eventType === "tool.patch.end") return "tool.completed";
  if (eventType === "subagent.spawn") return "subagent.spawned";
  return "session.updated";
}

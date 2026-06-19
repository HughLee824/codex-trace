import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "./doctor.ts";
import { indexAll } from "./indexer.ts";
import type { TraceStore } from "./store.ts";
import type { NormalizedEvent } from "./types.ts";

const MAX_PREVIEW_IMAGE_BYTES = 20 * 1024 * 1024;

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
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
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

  const usageMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/usage$/);
  if (usageMatch) {
    sendJson(response, 200, await options.store.getUsageStats(usageMatch[1]));
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

  if (pathname === "/api/files/image") {
    await serveLocalImage(url.searchParams.get("path"), response);
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

function sendText(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

async function serveLocalImage(filePath: string | null, response: ServerResponse): Promise<void> {
  if (!filePath || !isAbsolute(filePath)) {
    sendText(response, 400, "Image path must be absolute");
    return;
  }
  const type = imageContentType(filePath);
  if (!type) {
    sendText(response, 415, "Unsupported image type");
    return;
  }

  try {
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      sendText(response, 404, "Image not found");
      return;
    }
    if (stats.size > MAX_PREVIEW_IMAGE_BYTES) {
      sendText(response, 413, "Image is too large to preview");
      return;
    }
    const content = await readFile(filePath);
    if (!isSupportedImageContent(type, content)) {
      sendText(response, 415, "Unsupported image type");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      sendText(response, 404, "Image not found");
      return;
    }
    throw error;
  }
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

function isSupportedImageContent(type: string, content: Buffer): boolean {
  if (type === "image/png") {
    return content.length >= 8
      && content[0] === 0x89
      && content[1] === 0x50
      && content[2] === 0x4e
      && content[3] === 0x47
      && content[4] === 0x0d
      && content[5] === 0x0a
      && content[6] === 0x1a
      && content[7] === 0x0a;
  }
  if (type === "image/jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (type === "image/gif") {
    const signature = content.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (type === "image/webp") {
    return content.length >= 12
      && content.subarray(0, 4).toString("ascii") === "RIFF"
      && content.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (type === "image/avif") {
    const brand = content.subarray(8, 12).toString("ascii");
    return content.length >= 12 && content.subarray(4, 8).toString("ascii") === "ftyp" && (brand === "avif" || brand === "avis");
  }
  return false;
}

function imageContentType(file: string): string | undefined {
  switch (extname(file).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg": return "image/jpeg";
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    default: return undefined;
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

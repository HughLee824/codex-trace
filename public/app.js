let sessions = [];
let selected = null;
let selectedProject = "all";
let activeTab = "timeline";
let usageDensityFrame = 0;
const stickyUsageTop = 108;

const sessionsEl = document.getElementById("sessions");
const projectsEl = document.getElementById("projects");
const sessionsHeadingEl = document.getElementById("sessions-heading");
const sessionsCountEl = document.getElementById("sessions-count");
const panelEl = document.getElementById("panel");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const sessionsPageEl = document.getElementById("sessions-page");
const detailPageEl = document.getElementById("detail-page");
const backButton = document.getElementById("back-to-sessions");

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
    renderSelected();
  });
});

document.getElementById("reindex").addEventListener("click", async () => {
  statusEl.textContent = "Reindexing...";
  await fetch("/api/index/rebuild", { method: "POST" });
  await loadSessions();
});

searchEl.addEventListener("input", () => loadSessions(searchEl.value));
backButton.addEventListener("click", () => {
  selected = null;
  location.hash = "#/";
  renderRoute();
});
window.addEventListener("hashchange", renderRoute);
window.addEventListener("scroll", scheduleStickyUsageUpdate, { passive: true });
window.addEventListener("resize", scheduleStickyUsageUpdate);

async function loadSessions(q = "", options = {}) {
  sessions = await fetchJson(`/api/sessions${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  ensureSelectedProjectExists();
  renderProjects();
  renderSessions();
  statusEl.textContent = `${sessions.length} sessions indexed`;
  if (options.renderRoute !== false) renderRoute();
}

function renderSessions() {
  const visibleSessions = filterSessionsByProject(getGallerySessions());
  const activeProject = getProjectSummary().find((project) => project.key === selectedProject);
  sessionsHeadingEl.textContent = activeProject?.label || "All projects";
  sessionsCountEl.textContent = `${visibleSessions.length} sessions`;
  sessionsEl.innerHTML = visibleSessions.map((session) => {
    const project = deriveProject(session);
    return `
    <button class="session ${session.threadId === selected ? "active" : ""}" data-id="${escapeHtml(session.threadId)}">
      <span class="session-kind">${escapeHtml(session.threadSource || "unknown")}</span>
      <strong>${escapeHtml(session.threadName || shortId(session.threadId))}</strong>
      <span class="session-path">${escapeHtml(session.cwd || session.filePath || "")}</span>
      <span class="session-foot">
        <span>${escapeHtml(project.label)}</span>
        <span>${session.lineCount || 0} lines</span>
      </span>
    </button>
  `;
  }).join("") || `<div class="empty-state">No sessions in this project.</div>`;
  sessionsEl.querySelectorAll(".session").forEach((node) => {
    node.addEventListener("click", () => selectSession(node.dataset.id));
  });
}

function renderProjects() {
  const projects = getProjectSummary();
  projectsEl.innerHTML = projects.map((project) => `
    <button class="project-item ${project.key === selectedProject ? "active" : ""}" data-project="${escapeHtml(project.key)}" title="${escapeHtml(project.path || project.label)}">
      <span>
        <strong>${escapeHtml(project.label)}</strong>
        <small>${escapeHtml(project.path || "All indexed sessions")}</small>
      </span>
      <em>${project.count}</em>
    </button>
  `).join("");
  projectsEl.querySelectorAll("[data-project]").forEach((node) => {
    node.addEventListener("click", () => {
      selectedProject = node.dataset.project;
      renderProjects();
      renderSessions();
    });
  });
}

function filterSessionsByProject(records) {
  if (selectedProject === "all") return records;
  return records.filter((session) => deriveProject(session).key === selectedProject);
}

function getProjectSummary() {
  const byProject = new Map();
  const gallerySessions = getGallerySessions();
  for (const session of gallerySessions) {
    const project = deriveProject(session);
    const existing = byProject.get(project.key);
    const updatedAt = session.updatedAt || session.startedAt || "";
    if (existing) {
      existing.count += 1;
      if (updatedAt > existing.updatedAt) existing.updatedAt = updatedAt;
      continue;
    }
    byProject.set(project.key, { ...project, count: 1, updatedAt });
  }
  const projects = Array.from(byProject.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.label.localeCompare(b.label));
  return [
    { key: "all", label: "All projects", path: "", count: gallerySessions.length, updatedAt: projects[0]?.updatedAt || "" },
    ...projects,
  ];
}

function getGallerySessions() {
  return sessions.filter((session) => session.threadSource !== "subagent");
}

function deriveProject(session) {
  const path = session.cwd || "";
  if (!path) return { key: "unknown", label: "Unknown project", path: "" };
  const parts = path.split("/").filter(Boolean);
  const label = parts[parts.length - 1] || path;
  return { key: path, label, path };
}

function ensureSelectedProjectExists() {
  if (selectedProject === "all") return;
  if (!getGallerySessions().some((session) => deriveProject(session).key === selectedProject)) {
    selectedProject = "all";
  }
}

function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
}

async function selectSession(threadId, tab = "timeline") {
  selected = threadId;
  setActiveTab(tab);
  location.hash = `#/sessions/${encodeURIComponent(threadId)}`;
  await renderRoute();
}

async function renderRoute() {
  const match = location.hash.match(/^#\/sessions\/(.+)$/);
  if (!match) {
    selected = null;
    sessionsPageEl.hidden = false;
    detailPageEl.hidden = true;
    document.body.classList.remove("detail-mode");
    renderSessions();
    return;
  }

  selected = decodeURIComponent(match[1]);
  sessionsPageEl.hidden = true;
  detailPageEl.hidden = false;
  document.body.classList.add("detail-mode");
  renderSessions();
  setActiveTab(activeTab);
  await renderSelected();
}

async function renderSelected() {
  if (!selected) {
    panelEl.innerHTML = `<div class="card">No session selected.</div>`;
    return;
  }
  if (activeTab === "timeline") return renderTimeline();
  if (activeTab === "tools") return renderTools();
  if (activeTab === "subagents") return renderSubagents();
  if (activeTab === "events") return renderEvents();
}

async function renderTimeline() {
  const [data, usage] = await Promise.all([
    fetchJson(`/api/sessions/${encodeURIComponent(selected)}/timeline`),
    fetchJson(`/api/sessions/${encodeURIComponent(selected)}/usage`),
  ]);
  const messageRecords = data.messages || [];
  const toolRecords = data.toolCalls || data.tools || [];
  const messages = messageRecords.map((message) => {
    const timestamp = formatMessageTimestamp(message.timestamp);
    return `
    <div class="message ${escapeHtml(message.role)}">
      <div class="message-meta">
        <div class="message-kicker">
          <span class="badge">${escapeHtml(message.role)}</span>
          <span class="badge subtle">${escapeHtml(message.phase || message.source)}</span>
        </div>
        ${timestamp ? `<time class="message-time" datetime="${escapeHtml(message.timestamp)}">${escapeHtml(timestamp)}</time>` : ""}
      </div>
      <div class="message-body">${renderMarkdown(message.text)}</div>
    </div>
  `;
  }).join("");
  const compactUsage = shouldRenderStickyUsageCompact();
  panelEl.innerHTML = `
    ${renderSessionHero(data.session, [
      ["messages", messageRecords.length],
      ["tools", toolRecords.length],
      ["events", data.events?.length || 0],
    ])}
    ${renderAgentUsage(usage, compactUsage)}
    <section class="timeline-section">
      <div class="section-title"><h3>Messages</h3><span>${messageRecords.length}</span></div>
      ${messages || `<div class="empty-state">No messages captured.</div>`}
    </section>
  `;
  updateStickyUsageDensity();
  attachImageFallbacks(panelEl);
}

function attachImageFallbacks(root) {
  root.querySelectorAll(".message-attachment--image img").forEach((image) => {
    image.addEventListener("error", () => {
      const attachment = image.closest(".message-attachment--image");
      if (!attachment) return;
      attachment.classList.add("message-attachment--failed");
      const fallback = attachment.querySelector(".message-attachment__fallback");
      if (fallback) fallback.hidden = false;
    }, { once: true });
  });
}

function shouldRenderStickyUsageCompact() {
  const usage = panelEl.querySelector(".agent-usage");
  if (!usage) return false;
  return usage.classList.contains("agent-usage--compact")
    || usage.getBoundingClientRect().top <= stickyUsageTop + 1;
}

function scheduleStickyUsageUpdate() {
  if (usageDensityFrame) return;
  usageDensityFrame = requestAnimationFrame(() => {
    usageDensityFrame = 0;
    updateStickyUsageDensity();
  });
}

function updateStickyUsageDensity() {
  const usage = panelEl.querySelector(".agent-usage");
  if (!usage) return;
  const compact = usage.getBoundingClientRect().top <= stickyUsageTop + 1;
  if (usage.classList.contains("agent-usage--compact") !== compact) {
    usage.classList.toggle("agent-usage--compact", compact);
  }
}

async function renderTools() {
  const tools = await fetchJson(`/api/sessions/${encodeURIComponent(selected)}/tools`);
  panelEl.innerHTML = `
    <div class="tool-grid">
      ${tools.map((tool) => `
        <details class="tool ${tool.exitCode ? "bad" : ""}">
          <summary>
            <span class="badge">${escapeHtml(tool.name)}</span>
            <span>${escapeHtml(shortId(tool.callId))}</span>
            ${tool.exitCode !== null && tool.exitCode !== undefined ? `<span class="exit-code">exit ${tool.exitCode}</span>` : ""}
          </summary>
          <div class="meta">${escapeHtml(tool.cwd || "")}</div>
          <h3>Arguments</h3>
      <pre>${escapeHtml(tool.arguments || "")}</pre>
          <h3>Output</h3>
      <pre>${escapeHtml(tool.output || tool.stderr || tool.stdout || "")}</pre>
          ${tool.durationMs ? `<div class="meta">Duration ${formatDuration(tool.durationMs)}</div>` : ""}
          ${tool.changedFiles ? `<div class="meta">Changed: ${escapeHtml(tool.changedFiles.join(", "))}</div>` : ""}
        </details>
      `).join("") || `<div class="empty-state">No tools captured.</div>`}
    </div>
  `;
}

function renderAgentUsage(usage = {}, compact = false) {
  return `
    <section class="agent-usage${compact ? " agent-usage--compact" : ""}">
      <div class="usage-grid agent-usage__full">
        ${renderContextUsageCard(usage.current)}
        ${renderTokenBreakdown(usage.total)}
      </div>
      ${renderCompactUsageRow(usage)}
    </section>
  `;
}

function renderTokenBreakdown(usage = {}) {
  return getTokenUsageRows(usage).map(([label, value]) => `
        <div class="usage-card" title="${escapeHtml(formatNumber(value))}">
          <span class="usage-card__label">${escapeHtml(label)}</span>
          <strong class="usage-card__value">${escapeHtml(formatTokenAmount(value))}</strong>
        </div>
      `).join("");
}

function getTokenUsageRows(usage = {}) {
  return [
    ["Input", usage.inputTokens || 0],
    ["Cached input", usage.cachedInputTokens || 0],
    ["Output", usage.outputTokens || 0],
    ["Reasoning output", usage.reasoningOutputTokens || 0],
    ["Total", usage.totalTokens || 0],
  ];
}

function renderCompactUsageRow(usage) {
  usage = usage || {};
  return `
    <div class="usage-compact-row" aria-hidden="true">
      ${renderCompactUsageItem("Context window", formatContextPercent(usage.current))}
      ${getTokenUsageRows(usage.total).map(([label, value]) => renderCompactUsageItem(label, formatTokenAmount(value), formatNumber(value))).join("")}
    </div>
  `;
}

function renderCompactUsageItem(label, value, title = value) {
  return `
        <div class="usage-compact-item" title="${escapeHtml(title)}">
          <span class="usage-compact-item__label">${escapeHtml(label)}</span>
          <strong class="usage-compact-item__value">${escapeHtml(value)}</strong>
        </div>
      `;
}

function formatContextPercent(agent = {}) {
  const limit = agent.contextWindow || 0;
  return limit ? `${getContextPercent(agent)}%` : "Unknown";
}

function getContextPercent(agent = {}) {
  const used = agent.contextUsedTokens || 0;
  const limit = agent.contextWindow || 0;
  return limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

function renderContextUsageCard(agent = {}) {
  const used = agent.contextUsedTokens || 0;
  const limit = agent.contextWindow || 0;
  const percent = getContextPercent(agent);
  const percentLabel = formatContextPercent(agent);
  return `
    <div class="usage-card context-usage-card" data-tooltip="${escapeHtml(`${formatNumber(used)} / ${limit ? formatNumber(limit) : "unknown"}`)}">
      <span class="usage-card__label">Context window</span>
      <div class="context-donut" style="--context-percent: ${percent}">
        <i class="context-donut__cap context-donut__cap--start" style="--context-cap-opacity: ${percent ? 1 : 0}"></i>
        <i class="context-donut__cap context-donut__cap--end" style="--context-cap-angle: ${percent * 3.6}deg; --context-cap-opacity: ${percent ? 1 : 0}"></i>
        <span>${escapeHtml(percentLabel)}</span>
      </div>
    </div>
  `;
}

async function renderSubagents() {
  const edges = await fetchJson(`/api/sessions/${encodeURIComponent(selected)}/subagents`);
  panelEl.innerHTML = `
    <div class="subagent-list">
      ${edges.map((edge) => renderSubagentCard(edge)).join("") || `<div class="empty-state">No subagents captured.</div>`}
    </div>
  `;
  panelEl.querySelectorAll("[data-child]").forEach((card) => {
    const openChild = () => selectSession(card.dataset.child, "timeline");
    card.addEventListener("click", openChild);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openChild();
    });
  });
}

function renderSubagentCard(edge) {
  const childId = edge.childThreadId || edge.agentId || "";
  const name = edge.nickname || edge.agentId || edge.childThreadId || "subagent";
  const details = [edge.role || "worker", edge.statusSummary].filter(Boolean).join(" · ");
  const childSessionLabel = childId ? `Child session ${shortId(childId)}` : "No child session linked";
  const childTitle = childId || "No child session linked";
  const actionAttrs = childId
    ? ` data-child="${escapeHtml(childId)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(name)} child session"`
    : "";
  return `
    <article class="subagent-card ${childId ? "subagent-card--clickable" : ""}"${actionAttrs}>
      <span class="session-kind">subagent</span>
      <strong>${escapeHtml(name)}</strong>
      <div class="subagent-card__meta">${escapeHtml(details)}</div>
      <div class="subagent-card__session" title="${escapeHtml(childTitle)}">${escapeHtml(childSessionLabel)}</div>
    </article>
  `;
}

async function renderEvents() {
  const data = await fetchJson(`/api/sessions/${encodeURIComponent(selected)}/timeline`);
  const eventRecords = data.events || [];
  const events = eventRecords.slice(-120).reverse().map((event) => `
    <details class="event-row">
      <summary>
        <span class="badge">${escapeHtml(event.eventType)}</span>
        <span class="event-line">line ${event.lineNo}</span>
        <span>${escapeHtml(event.textPreview || "")}</span>
      </summary>
      <button class="secondary compact" data-raw="${event.id}">Show raw</button>
      <pre id="raw-${event.id}" hidden></pre>
    </details>
  `).join("");
  panelEl.innerHTML = `
    <section class="timeline-section events-section">
      <div class="section-title"><h3>Raw events</h3><span>${eventRecords.length}</span></div>
      ${events || `<div class="empty-state">No raw events captured.</div>`}
    </section>
  `;
  panelEl.querySelectorAll("[data-raw]").forEach((button) => {
    button.addEventListener("click", async () => {
      const raw = await fetchJson(`/api/events/${button.dataset.raw}/raw`);
      const target = document.getElementById(`raw-${button.dataset.raw}`);
      target.hidden = false;
      target.textContent = JSON.stringify(JSON.parse(raw.rawJson), null, 2);
    });
  });
}

function shouldRefreshSelectedSession(event) {
  if (!selected) return false;
  if (event?.threadId && event.threadId === selected) return true;
  if (!event?.filePath) return false;
  return sessions.some((session) => session.threadId === selected && session.filePath === event.filePath);
}

function handleLiveEvent(type, event) {
  if (type !== "session.updated") return Promise.resolve();

  const refreshSelected = shouldRefreshSelectedSession(event);
  return loadSessions(searchEl.value, { renderRoute: false }).then(() => {
    if (refreshSelected) return renderSelected();
  });
}

function connectLive() {
  const source = new EventSource("/api/live");
  source.onopen = () => { statusEl.textContent = "Live connected"; };
  source.onerror = () => { statusEl.textContent = "Live disconnected"; };
  ["session.updated", "turn.started", "tool.started", "tool.completed", "subagent.spawned", "event.appended"].forEach((type) => {
    source.addEventListener(type, (message) => {
      const event = JSON.parse(message.data);
      handleLiveEvent(type, event).catch(() => {
        statusEl.textContent = "Live update failed";
      });
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function unescapeDirectiveString(value) {
  return String(value ?? "").replace(/\\(["\\])/g, "$1");
}

function parseDirectiveAttributes(value) {
  const attributes = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_-]*)=("((?:\\.|[^"\\])*)"|[^\s]+)/g;
  let match;
  while ((match = pattern.exec(value))) {
    attributes[match[1]] = match[3] === undefined ? match[2] : unescapeDirectiveString(match[3]);
  }
  return attributes;
}

function parseCodeCommentDirective(line) {
  const prefix = `::code-comment${String.fromCharCode(123)}`;
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(String.fromCharCode(125))) return null;
  const attributes = parseDirectiveAttributes(trimmed.slice(prefix.length, -1));
  return attributes.title || attributes.body ? attributes : null;
}

function formatCodeCommentLocation(file, start, end) {
  const normalizedFile = String(file || "").replace(/\\/g, "/");
  const parts = normalizedFile.split("/").filter(Boolean);
  const shortFile = parts.slice(-2).join("/") || normalizedFile || "Unknown file";
  const startLine = String(start || "").trim();
  const endLine = String(end || "").trim();
  if (startLine && endLine && endLine !== startLine) return `${shortFile}:${startLine}-${endLine}`;
  if (startLine) return `${shortFile}:${startLine}`;
  return shortFile;
}

function renderCodeComment(comment) {
  const title = comment.title || "Code comment";
  const body = comment.body ? `<p class="review-comment__body">${renderInlineMarkdown(comment.body)}</p>` : "";
  const metaItems = [];
  if (comment.file) metaItems.push(formatCodeCommentLocation(comment.file, comment.start, comment.end));
  if (comment.priority) metaItems.push(`priority ${comment.priority}`);
  const meta = metaItems.length
    ? `<div class="review-comment__meta">${metaItems.map(escapeHtml).join(" · ")}</div>`
    : "";
  return `<section class="review-comment"><div class="review-comment__head"><span class="badge subtle">Code comment</span><strong>${escapeHtml(title)}</strong></div>${body}${meta}</section>`;
}

function renderMemoryCitation(raw) {
  const citationCount = (String(raw || "").match(/^[^<\n][^\n]*\|note=\[/gm) || []).length;
  const label = `Memory citations${citationCount ? ` · ${citationCount}` : ""}`;
  return `<details class="memory-citation"><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(raw)}</pre></details>`;
}

function isImageAttachmentPath(filePath) {
  const cleanPath = String(filePath || "").split("?")[0].split("#")[0].trim().toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"].some((extension) => cleanPath.endsWith(extension));
}

function parseFileAttachmentText(value) {
  const text = String(value || "").trim();
  const separator = text.indexOf(": ");
  if (separator <= 0) return null;
  const name = text.slice(0, separator).trim();
  const filePath = text.slice(separator + 2).trim();
  if (!name || !filePath || !isImageAttachmentPath(name) || !isImageAttachmentPath(filePath)) return null;
  return { name, path: filePath };
}

function parseImageDirective(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("<image ") || !trimmed.endsWith(">")) return null;
  const path = trimmed.match(/\bpath="([^"]+)"/)?.[1];
  if (!path || !isImageAttachmentPath(path)) return null;
  const name = trimmed.match(/\bname=\[([^\]]+)\]/)?.[1] || path.split("/").filter(Boolean).pop() || "Image";
  return { name, path };
}

function renderImageAttachment(attachment) {
  const source = `/api/files/image?path=${encodeURIComponent(attachment.path)}`;
  return `<figure class="message-attachment message-attachment--image"><a class="message-attachment__preview" href="${source}" target="_blank" rel="noreferrer"><img src="${source}" alt="${escapeHtml(attachment.name)}" loading="lazy"></a><div class="message-attachment__fallback" hidden>Preview unavailable</div><figcaption><span>${escapeHtml(attachment.name)}</span><code>${escapeHtml(attachment.path)}</code></figcaption></figure>`;
}

function renderMarkdown(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listItems = [];
  let codeLines = [];
  let codeLanguage = "";
  let inCodeBlock = false;
  let citationLines = [];
  let inMemoryCitation = false;
  let inFileMentions = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${renderInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    output.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushCodeBlock = () => {
    const className = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
    output.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    codeLanguage = "";
    inCodeBlock = false;
  };

  for (const line of lines) {
    const fence = line.match(/^ {0,3}```([A-Za-z0-9_-]+)?\s*$/);
    if (inCodeBlock) {
      if (fence) {
        flushCodeBlock();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (inMemoryCitation) {
      citationLines.push(line);
      if (line.trim() === "</oai-mem-citation>") {
        output.push(renderMemoryCitation(citationLines.join("\n")));
        citationLines = [];
        inMemoryCitation = false;
      }
      continue;
    }

    if (fence) {
      flushParagraph();
      flushList();
      inCodeBlock = true;
      codeLanguage = fence[1] || "";
      continue;
    }

    if (line.trim() === "<oai-mem-citation>") {
      flushParagraph();
      flushList();
      citationLines = [line];
      inMemoryCitation = true;
      continue;
    }

    const imageDirective = parseImageDirective(line);
    if (imageDirective) {
      flushParagraph();
      flushList();
      output.push(renderImageAttachment(imageDirective));
      continue;
    }

    const codeComment = parseCodeCommentDirective(line);
    if (codeComment) {
      flushParagraph();
      flushList();
      output.push(renderCodeComment(codeComment));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (inFileMentions) {
      const attachment = parseFileAttachmentText(line);
      if (attachment) {
        flushParagraph();
        flushList();
        output.push(renderImageAttachment(attachment));
        continue;
      }
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const headingText = heading[2].trim();
      if (headingText.toLowerCase() === "my request for codex:") inFileMentions = false;
      if (inFileMentions) {
        const attachment = parseFileAttachmentText(headingText);
        if (attachment) {
          output.push(renderImageAttachment(attachment));
          continue;
        }
      }
      output.push(`<h${level}>${renderInlineMarkdown(headingText)}</h${level}>`);
      if (headingText.toLowerCase() === "files mentioned by the user:") inFileMentions = true;
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCodeBlock) flushCodeBlock();
  if (inMemoryCitation) output.push(renderMemoryCitation(citationLines.join("\n")));
  flushParagraph();
  flushList();
  return output.join("");
}

function renderInlineMarkdown(value) {
  const placeholders = [];
  const stash = (html) => {
    const index = placeholders.push(html) - 1;
    return `\u0000${index}\u0000`;
  };
  let html = escapeHtml(value);

  html = html.replace(/`([^`\n]+)`/g, (_match, code) => stash(`<code>${code}</code>`));
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
    if (!isSafeMarkdownHref(href)) return `${label} (${href})`;
    return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || "");
}

function isSafeMarkdownHref(href) {
  const normalized = String(href || "").replace(/&amp;/g, "&").trim().toLowerCase();
  return normalized.startsWith("https://")
    || normalized.startsWith("http://")
    || normalized.startsWith("mailto:")
    || normalized.startsWith("/")
    || normalized.startsWith("#");
}

function shortId(value) {
  if (!value) return "";
  const string = String(value);
  return string.length > 13 ? `${string.slice(0, 8)}...${string.slice(-4)}` : string;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatTokenAmount(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(number);
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function formatMessageTimestamp(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
  return `${day} ${time}`;
}

function renderSessionHero(session, stats = []) {
  const title = session?.threadName || shortId(selected);
  const path = session?.filePath || "";
  return `
    <section class="trace-hero">
      <div>
        <p class="eyebrow">${escapeHtml(renderSessionKind(session))}</p>
        <h2>${escapeHtml(title)}</h2>
        <p class="trace-path" title="${escapeHtml(path)}">${escapeHtml(path)}</p>
      </div>
      <div class="trace-stats">
        ${stats.map(([label, value]) => `
          <span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSessionKind(session) {
  if (session?.threadSource === "subagent") return "Subagent";
  return "Main session";
}

connectLive();
loadSessions();

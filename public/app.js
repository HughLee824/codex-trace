let sessions = [];
let selected = null;
let selectedProject = "all";
let activeTab = "timeline";
const liveEvents = [];

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

async function loadSessions(q = "") {
  sessions = await fetchJson(`/api/sessions${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  ensureSelectedProjectExists();
  renderProjects();
  renderSessions();
  statusEl.textContent = `${sessions.length} sessions indexed`;
  renderRoute();
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
  if (!selected && activeTab !== "live") {
    panelEl.innerHTML = `<div class="card">No session selected.</div>`;
    return;
  }
  if (activeTab === "timeline") return renderTimeline();
  if (activeTab === "tools") return renderTools();
  if (activeTab === "subagents") return renderSubagents();
  if (activeTab === "live") return renderLive();
}

async function renderTimeline() {
  const data = await fetchJson(`/api/sessions/${encodeURIComponent(selected)}/timeline`);
  const messageRecords = data.messages || [];
  const eventRecords = data.events || [];
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
  const events = eventRecords.slice(-80).map((event) => `
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
    ${renderSessionHero(data.session, [
      ["messages", messageRecords.length],
      ["tools", toolRecords.length],
      ["events", eventRecords.length],
    ])}
    <section class="timeline-section">
      <div class="section-title"><h3>Messages</h3><span>${messageRecords.length}</span></div>
      ${messages || `<div class="empty-state">No messages captured.</div>`}
    </section>
    <section class="timeline-section">
      <div class="section-title"><h3>Raw event stream</h3><span>${eventRecords.length}</span></div>
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

async function renderSubagents() {
  const edges = await fetchJson(`/api/sessions/${encodeURIComponent(selected)}/subagents`);
  panelEl.innerHTML = edges.map((edge) => `
    <div class="subagent-card">
      <span class="session-kind">subagent</span>
      <strong>${escapeHtml(edge.nickname || edge.agentId || edge.childThreadId || "subagent")}</strong>
      <div class="meta">${escapeHtml(edge.role || "worker")} ${escapeHtml(edge.statusSummary || "")}</div>
      <div class="edge-line">
        <span>${escapeHtml(shortId(edge.parentThreadId || ""))}</span>
        <span>to</span>
        <span>${escapeHtml(shortId(edge.childThreadId || ""))}</span>
      </div>
      ${edge.childThreadId ? `<button data-child="${escapeHtml(edge.childThreadId)}">Open child</button>` : ""}
    </div>
  `).join("") || `<div class="empty-state">No subagents captured.</div>`;
  panelEl.querySelectorAll("[data-child]").forEach((button) =>
    button.addEventListener("click", () => selectSession(button.dataset.child, "timeline")),
  );
}

function renderLive() {
  panelEl.innerHTML = `
    <section class="timeline-section live-section">
      <div class="section-title"><h3>Live stream</h3><span>${liveEvents.length}</span></div>
      ${liveEvents.slice(-120).reverse().map((event) => `
        <div class="event-row">
          <span class="badge">${escapeHtml(event.eventType)}</span>
          <span class="badge subtle">${escapeHtml(shortId(event.threadId || ""))}</span>
          ${escapeHtml(event.textPreview || event.toolName || "")}
        </div>
      `).join("") || `<div class="empty-state">Waiting for live events...</div>`}
    </section>
  `;
}

function connectLive() {
  const source = new EventSource("/api/live");
  source.onopen = () => { statusEl.textContent = "Live connected"; };
  source.onerror = () => { statusEl.textContent = "Live disconnected"; };
  ["session.updated", "turn.started", "tool.started", "tool.completed", "subagent.spawned", "event.appended"].forEach((type) => {
    source.addEventListener(type, (message) => {
      const event = JSON.parse(message.data);
      liveEvents.push(event);
      if (activeTab === "live") renderLive();
      if (type === "session.updated") loadSessions(searchEl.value);
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

function renderMarkdown(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listItems = [];
  let codeLines = [];
  let codeLanguage = "";
  let inCodeBlock = false;

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

    if (fence) {
      flushParagraph();
      flushList();
      inCodeBlock = true;
      codeLanguage = fence[1] || "";
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
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
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCodeBlock) flushCodeBlock();
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
  return `
    <section class="trace-hero">
      <div>
        <p class="eyebrow">${escapeHtml(session?.threadSource || "session")}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(session?.filePath || "")}</p>
      </div>
      <div class="trace-stats">
        ${stats.map(([label, value]) => `
          <span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>
        `).join("")}
      </div>
    </section>
  `;
}

connectLive();
loadSessions();

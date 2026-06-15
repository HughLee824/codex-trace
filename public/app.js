let sessions = [];
let selected = null;
let activeTab = "timeline";
const liveEvents = [];

const sessionsEl = document.getElementById("sessions");
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
  renderSessions();
  statusEl.textContent = `${sessions.length} sessions indexed`;
  renderRoute();
}

function renderSessions() {
  sessionsEl.innerHTML = sessions.map((session) => `
    <button class="session ${session.threadId === selected ? "active" : ""}" data-id="${escapeHtml(session.threadId)}">
      <span class="session-kind">${escapeHtml(session.threadSource || "unknown")}</span>
      <strong>${escapeHtml(session.threadName || shortId(session.threadId))}</strong>
      <span class="session-path">${escapeHtml(session.cwd || session.filePath || "")}</span>
      <span class="session-foot">
        <span>${escapeHtml(shortId(session.threadId))}</span>
        <span>${session.lineCount || 0} lines</span>
      </span>
    </button>
  `).join("");
  sessionsEl.querySelectorAll(".session").forEach((node) => {
    node.addEventListener("click", () => selectSession(node.dataset.id));
  });
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
  const messages = messageRecords.map((message) => `
    <div class="message ${escapeHtml(message.role)}">
      <div class="message-kicker">
        <span class="badge">${escapeHtml(message.role)}</span>
        <span class="badge subtle">${escapeHtml(message.phase || message.source)}</span>
      </div>
      <p>${escapeHtml(message.text)}</p>
    </div>
  `).join("");
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

function shortId(value) {
  if (!value) return "";
  const string = String(value);
  return string.length > 13 ? `${string.slice(0, 8)}...${string.slice(-4)}` : string;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

test("UI separates session list route from session detail route", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");

  assert.match(html, /id="sessions-page"/);
  assert.match(html, /id="detail-page"[\s\S]*hidden/);
  assert.match(html, /id="back-to-sessions"/);
  assert.match(js, /#\/sessions\/\$\{encodeURIComponent\(threadId\)\}/);
  assert.match(js, /location\.hash\.match\(\/\^#\\\/sessions\\\//);
  assert.doesNotMatch(js, /if \(!selected && sessions\[0\]\) selectSession/);
  assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(320px, 1fr\)\)/);
  assert.match(css, /\[hidden\]\s*\{\s*display: none !important;\s*\}/);
});

test("opening a child session resets detail view to timeline output", async () => {
  const js = await readFile("public/app.js", "utf8");

  assert.match(js, /function setActiveTab\(tab\)/);
  assert.match(js, /async function selectSession\(threadId, tab = "timeline"\)/);
  assert.match(js, /selectSession\(card\.dataset\.child, "timeline"\)/);
  assert.match(js, /card\.addEventListener\("keydown"/);
  assert.match(js, /setActiveTab\(tab\)/);
});

test("subagent detail chrome links back to the parent and hides the subagents tab", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");

  assert.match(html, /id="back-to-parent"[\s\S]*hidden/);
  assert.match(js, /parentButton\.addEventListener\("click"/);
  assert.match(js, /selectSession\(session\.parentThreadId, "subagents"\)/);

  const code = [
    `
      let selected = "child-1";
      let selectedSession = null;
      let activeTab = "subagents";
      const sessions = [{
        threadId: "child-1",
        threadSource: "subagent",
        parentThreadId: "parent-1",
        agentNickname: "Normalize store intake",
      }];
      const toggles = [];
      const buttons = ["timeline", "tools", "subagents", "events"].map((tab) => ({
        dataset: { tab },
        hidden: false,
        classList: { toggle: (name, enabled) => toggles.push([tab, name, enabled]) },
      }));
      const parentButton = { hidden: true, title: "" };
      const document = {
        querySelectorAll(selector) {
          if (selector !== "[data-tab]") throw new Error(selector);
          return buttons;
        },
      };
    `,
    extractFunction(js, "getSelectedSession"),
    extractFunction(js, "isSubagentSession"),
    extractFunction(js, "getAvailableDetailTabs"),
    extractFunction(js, "setActiveTab"),
    extractFunction(js, "syncDetailControls"),
    `
      syncDetailControls();
      ({ activeTab, parentHidden: parentButton.hidden, parentTitle: parentButton.title, subagentsHidden: buttons[2].hidden, toggles });
    `,
  ].join("\n");

  const result = await vm.runInNewContext(code);

  assert.equal(result.activeTab, "timeline");
  assert.equal(result.parentHidden, false);
  assert.match(result.parentTitle, /parent-1/);
  assert.equal(result.subagentsHidden, true);
  assert.ok(result.toggles.some(([tab, name, enabled]) => tab === "timeline" && name === "active" && enabled === true));
});

test("subagent detail chrome uses selected metadata when the gallery is filtered", async () => {
  const js = await readFile("public/app.js", "utf8");
  const code = [
    `
      let selected = "child-1";
      let selectedSession = {
        threadId: "child-1",
        threadSource: "subagent",
        parentThreadId: "parent-1",
        agentNickname: "Normalize store intake",
      };
      let activeTab = "subagents";
      const sessions = [{ threadId: "parent-1", threadSource: "user", threadName: "Parent" }];
      const buttons = ["timeline", "tools", "subagents", "events"].map((tab) => ({
        dataset: { tab },
        hidden: false,
        classList: { toggle() {} },
      }));
      const parentButton = { hidden: true, title: "" };
      const document = {
        querySelectorAll(selector) {
          if (selector !== "[data-tab]") throw new Error(selector);
          return buttons;
        },
      };
    `,
    extractFunction(js, "getSelectedSession"),
    extractFunction(js, "isSubagentSession"),
    extractFunction(js, "getAvailableDetailTabs"),
    extractFunction(js, "setActiveTab"),
    extractFunction(js, "syncDetailControls"),
    `
      const session = getSelectedSession();
      syncDetailControls();
      ({ sessionThreadId: session?.threadId, parentHidden: parentButton.hidden, subagentsHidden: buttons[2].hidden, activeTab });
    `,
  ].join("\n");

  const result = await vm.runInNewContext(code);

  assert.equal(result.sessionThreadId, "child-1");
  assert.equal(result.parentHidden, false);
  assert.equal(result.subagentsHidden, true);
  assert.equal(result.activeTab, "timeline");
});

test("selected session metadata loads outside the filtered gallery", async () => {
  const js = await readFile("public/app.js", "utf8");
  const code = [
    `
      let selected = "child-1";
      let selectedSession = null;
      const sessions = [{ threadId: "parent-1", threadSource: "user", threadName: "Parent" }];
      const requests = [];
      function fetchJson(url) {
        requests.push(url);
        return Promise.resolve({
          threadId: "child-1",
          threadSource: "subagent",
          parentThreadId: "parent-1",
          agentNickname: "Normalize store intake",
        });
      }
    `,
    extractFunction(js, "getSelectedSession"),
    extractFunction(js, "loadSelectedSession"),
    `
      (async () => {
        await loadSelectedSession("child-1");
        return { requests, session: getSelectedSession() };
      })();
    `,
  ].join("\n");

  const result = await vm.runInNewContext(code);

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0], "/api/sessions/child-1");
  assert.equal(result.session.threadId, "child-1");
  assert.equal(result.session.parentThreadId, "parent-1");
});

test("subagent hero shows a stable subagent name and parent session reference", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const code = [
    `let selected = "child-1";`,
    extractFunction(js, "escapeHtml"),
    extractFunction(js, "shortId"),
    extractFunction(js, "renderSessionKind"),
    extractFunction(js, "getSessionTitle"),
    extractFunction(js, "renderSessionHeroMeta"),
    extractFunction(js, "renderSessionHero"),
    `
      renderSessionHero({
        threadSource: "subagent",
        threadName: "Normalize store intake",
        agentNickname: "intake-worker",
        agentRole: "worker",
        parentThreadId: "parent-1",
        filePath: "/tmp/child.jsonl",
      }, [["messages", 11]], "child-1");
    `,
  ].join("\n");

  const hero = await vm.runInNewContext(code);

  assert.match(hero, /<h2>intake-worker<\/h2>/);
  assert.match(hero, /Subagent name/);
  assert.match(hero, /Normalize store intake/);
  assert.match(hero, /Parent session/);
  assert.match(hero, /parent-1/);
  assert.match(css, /\.trace-hero-meta/);
});

test("live events refresh the currently selected session detail view", async () => {
  const js = await readFile("public/app.js", "utf8");
  const code = [
    `
      let selected = "thread-1";
      let activeTab = "timeline";
      const sessions = [{ threadId: "thread-1", filePath: "/tmp/thread-1.jsonl" }];
      const searchEl = { value: "needle" };
      const calls = [];
      function renderSelected() { calls.push("renderSelected"); }
      function loadSessions(value, options) {
        calls.push(["loadSessions", value, options]);
        return Promise.resolve();
      }
    `,
    extractFunction(js, "shouldRefreshSelectedSession"),
    extractFunction(js, "handleLiveEvent"),
    `
      (async () => {

        await handleLiveEvent("event.appended", { threadId: "thread-1" });
        await handleLiveEvent("session.updated", { threadId: "thread-2" });
        await handleLiveEvent("session.updated", { filePath: "/tmp/thread-1.jsonl" });
        activeTab = "events";
        await handleLiveEvent("session.updated", { threadId: "thread-1" });

        return calls;
      })();
    `,
  ].join("\n");

  const calls = JSON.parse(JSON.stringify(await vm.runInNewContext(code)));

  assert.deepEqual(calls, [
    ["loadSessions", "needle", { renderRoute: false }],
    ["loadSessions", "needle", { renderRoute: false }],
    "renderSelected",
    ["loadSessions", "needle", { renderRoute: false }],
    "renderSelected",
  ]);
});

test("stale detail renders cannot overwrite a newer tab selection", async () => {
  const js = await readFile("public/app.js", "utf8");
  const code = [
    `
      let selected = "thread-1";
      let activeTab = "timeline";
      let renderSequence = 0;
      const panelEl = {
        innerHTML: "",
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      const pending = {};
      function fetchJson(url) {
        if (url.endsWith("/timeline") || url.endsWith("/usage")) {
          return new Promise((resolve) => {
            pending[url.slice(url.lastIndexOf("/") + 1)] = resolve;
          });
        }
        if (url.endsWith("/tools")) {
          return Promise.resolve([{ callId: "call-1", name: "exec_command", arguments: "{}" }]);
        }
        throw new Error(url);
      }
      function renderSessionHero() { return '<section class="trace-hero">Timeline</section>'; }
      function renderAgentUsage() { return ""; }
      function shouldRenderStickyUsageCompact() { return false; }
      function updateStickyUsageDensity() {}
      function attachImageFallbacks() {}
      function renderMarkdown(value) { return value; }
      function formatMessageTimestamp() { return ""; }
      function formatDuration() { return ""; }
    `,
    extractFunction(js, "escapeHtml"),
    extractFunction(js, "shortId"),
    js.includes("function isCurrentRender(") ? extractFunction(js, "isCurrentRender") : "",
    extractFunction(js, "renderSelected"),
    extractFunction(js, "renderTimeline"),
    extractFunction(js, "renderTools"),
    `
      (async () => {
        const timelineRender = renderSelected();
        activeTab = "tools";
        await renderSelected();
        const toolsHtml = panelEl.innerHTML;
        pending.timeline({ session: { threadName: "Thread" }, messages: [], toolCalls: [], events: [] });
        pending.usage({});
        await timelineRender;
        return { toolsHtml, finalHtml: panelEl.innerHTML };
      })();
    `,
  ].join("\n");

  const result = await vm.runInNewContext(code);

  assert.match(result.toolsHtml, /class="tool-grid"/);
  assert.match(result.finalHtml, /class="tool-grid"/);
  assert.doesNotMatch(result.finalHtml, /trace-hero/);
});

test("session cards show recent activity time", async () => {
  const js = await readFile("public/app.js", "utf8");
  const code = [
    `
      let selected = null;
      let selectedProject = "all";
      const sessions = [{
        threadId: "thread-1",
        threadName: "Recent work",
        threadSource: "user",
        cwd: "/work/codex-trace",
        filePath: "/tmp/thread-1.jsonl",
        updatedAt: "2026-06-14T00:00:08.000Z",
        startedAt: "2026-06-14T00:00:00.000Z",
        lineCount: 42,
      }];
      const sessionsHeadingEl = { textContent: "" };
      const sessionsCountEl = { textContent: "" };
      const sessionsEl = { innerHTML: "", querySelectorAll: () => [] };
      function selectSession() {}
    `,
    extractFunction(js, "escapeHtml"),
    extractFunction(js, "shortId"),
    extractFunction(js, "formatMessageTimestamp"),
    extractFunction(js, "formatSessionActiveTime"),
    extractFunction(js, "deriveProject"),
    extractFunction(js, "getGallerySessions"),
    extractFunction(js, "filterSessionsByProject"),
    extractFunction(js, "getProjectSummary"),
    extractFunction(js, "renderSessions"),
    `
      renderSessions();
      sessionsEl.innerHTML;
    `,
  ].join("\n");

  const html = await vm.runInNewContext(code);

  assert.match(html, /Recent work/);
  assert.match(html, /Active /);
  assert.match(html, /42 lines/);
});

test("session gallery omits redundant user source badge", async () => {
  const js = await readFile("public/app.js", "utf8");
  const code = [
    `
      let selected = null;
      let selectedProject = "all";
      const sessions = [{
        threadId: "thread-1",
        threadName: "Recent work",
        threadSource: "user",
        cwd: "/work/codex-trace",
        filePath: "/tmp/thread-1.jsonl",
        updatedAt: "2026-06-14T00:00:08.000Z",
        lineCount: 42,
      }];
      const sessionsHeadingEl = { textContent: "" };
      const sessionsCountEl = { textContent: "" };
      const sessionsEl = { innerHTML: "", querySelectorAll: () => [] };
      function selectSession() {}
    `,
    extractFunction(js, "escapeHtml"),
    extractFunction(js, "shortId"),
    extractFunction(js, "formatMessageTimestamp"),
    extractFunction(js, "formatSessionActiveTime"),
    extractFunction(js, "deriveProject"),
    extractFunction(js, "getGallerySessions"),
    extractFunction(js, "filterSessionsByProject"),
    extractFunction(js, "getProjectSummary"),
    extractFunction(js, "renderSessions"),
    `
      renderSessions();
      sessionsEl.innerHTML;
    `,
  ].join("\n");

  const html = await vm.runInNewContext(code);
  const renderSubagentCard = extractFunction(js, "renderSubagentCard");

  assert.doesNotMatch(html, /class="session-kind"/);
  assert.doesNotMatch(html, />user</);
  assert.match(renderSubagentCard, /class="session-kind">subagent/);
});

test("timeline messages expose timestamps in a tighter detail layout", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");

  assert.match(js, /formatMessageTimestamp\(message\.timestamp\)/);
  assert.match(js, /class="message-time"/);
  assert.match(css, /max-width: 1040px/);
  assert.match(css, /\.message-time/);
});

test("timeline messages render common markdown safely", async () => {
  const js = await readFile("public/app.js", "utf8");
  const renderMarkdown = getRenderMarkdown(js);

  const html = renderMarkdown([
    "**Done** with `code` and [docs](https://example.com).",
    "",
    "- first",
    "- <script>alert(1)</script>",
    "",
    "   ```json",
    "{\"ok\": true}",
    "   ```",
  ].join("\n"));

  assert.match(html, /<strong>Done<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer">docs<\/a>/);
  assert.match(html, /<ul>[\s\S]*<li>first<\/li>[\s\S]*<li>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li>[\s\S]*<\/ul>/);
  assert.match(html, /<pre><code class="language-json">\{&quot;ok&quot;: true\}<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>/);
});

test("timeline messages render review directives as compact audit blocks", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const renderMarkdown = getRenderMarkdown(js);

  const html = renderMarkdown([
    "Found one actionable issue.",
    "",
    "::code-comment{title=\"[P2] Hidden compact/full row still leaves grid gap\" body=\"`.agent-usage` keeps an extra gap.\" file=\"/Users/hui/Somnus/Project/codex-trace/public/styles.css\" start=629 priority=2}",
    "No other issues.",
    "",
    "<oai-mem-citation>",
    "<citation_entries>",
    "MEMORY.md:50-54|note=[context token usage UI history]",
    "</citation_entries>",
    "</oai-mem-citation>",
  ].join("\n"));

  assert.match(html, /class="review-comment"/);
  assert.match(html, /\[P2\] Hidden compact\/full row still leaves grid gap/);
  assert.match(html, /<code>\.agent-usage<\/code> keeps an extra gap\./);
  assert.match(html, /public\/styles\.css:629/);
  assert.match(html, /priority 2/);
  assert.match(html, /<details class="memory-citation">/);
  assert.match(html, /Memory citations · 1/);
  assert.match(html, /MEMORY\.md:50-54\|note=\[context token usage UI history\]/);
  assert.doesNotMatch(html, /::code-comment/);
  assert.doesNotMatch(html, /<oai-mem-citation>/);
  assert.match(css, /\.review-comment/);
  assert.match(css, /\.review-comment__meta/);
  assert.match(css, /\.memory-citation/);
});

test("timeline messages render subagent notifications as readable handoff cards", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const renderMarkdown = getRenderMarkdown(js);

  const payload = {
    agent_path: "019edead-4fb1-7231-b447-72bbe96f9b5e",
    status: {
      completed: [
        "Stage 9B handoff:",
        "",
        "- packetPath: /Users/hui/.codex/plugins/cache/storewright/workflows/stages/09B-shopify-media-upload.md",
        "- artifactsWritten: .storewright/runs/tactilery-20260619-001/shopify-media-map.json",
        "- blockers: Shopify media upload cannot proceed safely.",
        "",
        "Validation: shopify-media-map.json passed the Storewright schema validator.",
      ].join("\n"),
    },
  };

  const html = renderMarkdown(`<subagent_notification>\n${JSON.stringify(payload)}\n</subagent_notification>`);

  assert.match(html, /class="subagent-notification"/);
  assert.match(html, /Subagent completed/);
  assert.match(html, /019edead-4fb1-7231-b447-72bbe96f9b5e/);
  assert.match(html, /<p>Stage 9B handoff:<\/p>/);
  assert.match(html, /<li>packetPath: \/Users\/hui\/\.codex\/plugins\/cache\/storewright\/workflows\/stages\/09B-shopify-media-upload\.md<\/li>/);
  assert.match(html, /<li>blockers: Shopify media upload cannot proceed safely\.<\/li>/);
  assert.match(html, /Validation: shopify-media-map\.json passed/);
  assert.doesNotMatch(html, /&lt;subagent_notification&gt;/);
  assert.doesNotMatch(html, /&quot;agent_path&quot;/);
  assert.match(css, /\.subagent-notification/);
  assert.match(css, /\.subagent-notification__body/);
});

test("timeline messages render embedded subagent notification blocks with surrounding content", async () => {
  const js = await readFile("public/app.js", "utf8");
  const renderMarkdown = getRenderMarkdown(js);
  const payload = {
    agent_path: "019edead-4fb1-7231-b447-72bbe96f9b5e",
    status: { blocked: "Stage 9B blocked:\n\n- blockers: missing target-bound upload API" },
  };

  const html = renderMarkdown([
    `<subagent_notification>`,
    JSON.stringify(payload),
    `</subagent_notification>`,
    "",
    "---",
    "继续看这个message渲染，能优化吗？",
    "<image name=[Image #1] path=\"/tmp/subagent-message.png\">",
  ].join("\n"));

  assert.match(html, /class="subagent-notification"/);
  assert.match(html, /Subagent blocked/);
  assert.match(html, /<li>blockers: missing target-bound upload API<\/li>/);
  assert.match(html, /继续看这个message渲染/);
  assert.match(html, /<img src="\/api\/files\/image\?path=%2Ftmp%2Fsubagent-message\.png"/);
  assert.doesNotMatch(html, /&lt;subagent_notification&gt;/);
  assert.doesNotMatch(html, /&quot;agent_path&quot;/);
});

test("timeline messages render single-line subagent notification wrappers", async () => {
  const js = await readFile("public/app.js", "utf8");
  const renderMarkdown = getRenderMarkdown(js);
  const payload = {
    agent_path: "019edead-4fb1-7231-b447-72bbe96f9b5e",
    status: { completed: "Stage 9B handoff:\n\n- artifactsWritten: shopify-media-map.json" },
  };

  const html = renderMarkdown(`<subagent_notification>${JSON.stringify(payload)}</subagent_notification>`);

  assert.match(html, /class="subagent-notification"/);
  assert.match(html, /Subagent completed/);
  assert.match(html, /<li>artifactsWritten: shopify-media-map\.json<\/li>/);
  assert.doesNotMatch(html, /&lt;subagent_notification&gt;/);
  assert.doesNotMatch(html, /&quot;agent_path&quot;/);
});

test("timeline messages render Codex action directives through a generic registry", async () => {
  const js = await readFile("public/app.js", "utf8");
  const renderMarkdown = getRenderMarkdown(js);

  const html = renderMarkdown([
    "::git-stage{cwd=\"/Users/hui/Somnus/Project/codex-trace\"}",
    "::git-commit{cwd=\"/Users/hui/Somnus/Project/codex-trace\"}",
    "::created-thread{threadId=\"019edead-4fb1-7231-b447-72bbe96f9b5e\"}",
    "::future-directive{foo=\"bar\" count=2}",
  ].join("\n"));

  assert.match(html, /class="codex-directive codex-directive--git-stage"/);
  assert.match(html, /Git staged/);
  assert.match(html, /codex-trace/);
  assert.match(html, /class="codex-directive codex-directive--created-thread"/);
  assert.match(html, /Created thread/);
  assert.match(html, /019edead-4fb1-7231-b447-72bbe96f9b5e/);
  assert.match(html, /class="codex-directive codex-directive--future-directive"/);
  assert.match(html, /Future directive/);
  assert.match(html, /<dt>foo<\/dt><dd><code>bar<\/code><\/dd>/);
  assert.doesNotMatch(html, /::git-stage/);
  assert.doesNotMatch(html, /::future-directive/);
});

test("timeline messages render mentioned image files as previews", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const renderMarkdown = getRenderMarkdown(js);

  const html = renderMarkdown([
    "# Files mentioned by the user:",
    "",
    "## codex-clipboard.png: /var/folders/demo/codex-clipboard.png",
    "",
    "## recording.mov: /Users/hui/Desktop/recording.mov",
    "",
    "## My request for Codex:",
    "请看图片",
    "",
    "<image name=[Image #1] path=\"/tmp/inline-image.webp\">",
  ].join("\n"));

  assert.match(html, /<figure class="message-attachment message-attachment--image">/);
  assert.match(html, /<img src="\/api\/files\/image\?path=%2Fvar%2Ffolders%2Fdemo%2Fcodex-clipboard\.png"/);
  assert.match(html, /alt="codex-clipboard\.png"/);
  assert.match(html, /codex-clipboard\.png/);
  assert.match(html, /\/var\/folders\/demo\/codex-clipboard\.png/);
  assert.match(html, /<h2>recording\.mov: \/Users\/hui\/Desktop\/recording\.mov<\/h2>/);
  assert.match(html, /<img src="\/api\/files\/image\?path=%2Ftmp%2Finline-image\.webp"/);
  assert.match(html, /Image #1/);
  assert.match(css, /\.message-attachment--image/);
  assert.match(css, /\.message-attachment--image img/);
});

test("timeline image previews expose a graceful load failure state", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const renderTimeline = extractFunction(js, "renderTimeline");
  const attachImageFallbacks = extractFunction(js, "attachImageFallbacks");

  assert.match(renderTimeline, /attachImageFallbacks\(panelEl\)/);
  assert.match(attachImageFallbacks, /addEventListener\("error"/);
  assert.match(attachImageFallbacks, /classList\.add\("message-attachment--failed"\)/);
  assert.match(js, /class="message-attachment__fallback" hidden/);
  assert.match(js, /Preview unavailable/);
  assert.match(css, /\.message-attachment--failed \.message-attachment__preview[\s\S]*display: none/);
  assert.match(css, /\.message-attachment__fallback/);
});

test("session gallery supports project-first browsing", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");

  assert.match(html, /id="projects"/);
  assert.match(html, /id="sessions-heading"/);
  assert.match(js, /let selectedProject = "all"/);
  assert.match(js, /function deriveProject\(session\)/);
  assert.match(js, /function getGallerySessions\(\)/);
  assert.match(js, /session\.threadSource !== "subagent"/);
  assert.match(js, /renderProjects\(\)/);
  assert.match(js, /filterSessionsByProject\(/);
  assert.match(css, /\.gallery-shell/);
  assert.match(css, /\.project-list/);
  assert.doesNotMatch(css, /\.session-results[\s\S]*overflow-y: auto/);
  assert.doesNotMatch(css, /\.gallery-shell[\s\S]*max-height: calc/);
});

test("timeline renders context usage as a donut card with compact token cards", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const renderTimeline = extractFunction(js, "renderTimeline");

  assert.doesNotMatch(html, /data-tab="stats"/);
  assert.match(html, /data-tab="events"/);
  assert.doesNotMatch(html, /data-tab="live"/);
  assert.doesNotMatch(js, /renderStats/);
  assert.doesNotMatch(js, /function renderLive/);
  assert.doesNotMatch(js, /activeTab !== "live"/);
  assert.doesNotMatch(css, /\.live-section/);
  assert.match(js, /Promise\.all\(\[/);
  assert.match(js, /\/api\/sessions\/\$\{encodeURIComponent\(threadId\)\}\/usage/);
  assert.match(js, /renderAgentUsage\(usage, compactUsage\)/);
  assert.match(renderTimeline, /const compactUsage = shouldRenderStickyUsageCompact\(\)/);
  assert.match(renderTimeline, /updateStickyUsageDensity\(\)/);
  assert.doesNotMatch(renderTimeline, /Raw event stream/);
  assert.doesNotMatch(renderTimeline, /data-raw/);
  assert.doesNotMatch(renderTimeline, /eventRecords\.slice/);
  assert.doesNotMatch(renderTimeline, /renderSessionHero\(data\.session,[\s\S]*usage\.current/);
  assert.match(js, /renderSessionKind\(session\)/);
  assert.match(js, /Main session/);
  assert.match(js, /Subagent/);
  assert.match(js, /function renderAgentUsage\(usage = \{\}, compact = false\) \{[\s\S]*agent-usage\$\{compact \? " agent-usage--compact" : ""\}/);
  assert.match(js, /function renderAgentUsage\(usage = \{\}, compact = false\) \{[\s\S]*renderContextUsageCard\(usage\.current\)/);
  assert.match(js, /function renderAgentUsage\(usage = \{\}, compact = false\) \{[\s\S]*renderTokenBreakdown\(usage\.total\)/);
  assert.match(js, /function renderAgentUsage\(usage = \{\}, compact = false\) \{[\s\S]*renderCompactUsageRow\(usage\)/);
  assert.match(js, /function renderTokenBreakdown/);
  assert.match(js, /function getTokenUsageRows/);
  assert.match(js, /function renderCompactUsageRow/);
  assert.match(js, /function renderCompactUsageItem/);
  assert.match(js, /function formatContextPercent/);
  assert.match(js, /function formatTokenAmount/);
  assert.match(js, /function renderContextUsageCard/);
  assert.match(js, /Math\.round\(\(used \/ limit\) \* 100\)/);
  assert.doesNotMatch(js, /Math\.round\(\(used \/ limit\) \* 1000\) \/ 10/);
  assert.doesNotMatch(js, /function renderContextMeter/);
  assert.doesNotMatch(js, /function renderContextDonut/);
  assert.doesNotMatch(js, /function renderCurrentContextUsage/);
  assert.doesNotMatch(js, /function renderContextChart/);
  assert.doesNotMatch(js, /<h3>Token usage<\/h3>/);
  assert.doesNotMatch(js, /<h3>Context usage<\/h3>/);
  assert.doesNotMatch(js, /current agent/);
  assert.doesNotMatch(js, /Current agent/);
  assert.match(js, /class="usage-card context-usage-card"/);
  assert.match(js, /data-tooltip=/);
  assert.match(js, /class="usage-card__label">Context window/);
  assert.match(js, /class="context-donut"/);
  assert.match(js, /context-donut__cap context-donut__cap--start/);
  assert.match(js, /context-donut__cap context-donut__cap--end/);
  assert.match(js, /--context-cap-angle: \$\{percent \* 3\.6\}deg/);
  assert.match(js, /--context-cap-opacity: \$\{percent \? 1 : 0\}/);
  assert.doesNotMatch(js, /context-usage-card__actual/);
  assert.doesNotMatch(js, /class="context-meter"/);
  assert.match(js, /class="usage-card__value"/);
  assert.doesNotMatch(js, /class="usage-card__unit"/);
  assert.doesNotMatch(js, />tokens</);
  assert.match(js, /title="\$\{escapeHtml\(formatNumber\(value\)\)\}"/);
  assert.match(css, /\.usage-grid/);
  assert.match(css, /\.agent-usage[\s\S]*position: sticky/);
  assert.match(css, /\.agent-usage[\s\S]*top: 108px/);
  assert.match(css, /\.agent-usage[\s\S]*z-index: [1-8]/);
  assert.doesNotMatch(css, /\.agent-usage\s*\{[^}]*\bgap:/);
  assert.match(css, /\.agent-usage__full/);
  assert.match(css, /\.agent-usage__full[\s\S]*max-height: 112px/);
  assert.match(css, /\.agent-usage__full[\s\S]*transition: max-height 180ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.match(css, /\.usage-compact-row/);
  assert.match(css, /\.usage-compact-row[\s\S]*display: flex/);
  assert.match(css, /\.usage-compact-row[\s\S]*overflow-x: auto/);
  assert.match(css, /\.usage-compact-row[\s\S]*max-height: 0/);
  assert.match(css, /\.usage-compact-row[\s\S]*opacity: 0/);
  assert.match(css, /\.usage-compact-row[\s\S]*transition: max-height 180ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.match(css, /\.usage-compact-item/);
  assert.match(css, /\.usage-compact-item[\s\S]*flex: 1 0 118px/);
  assert.match(css, /\.usage-compact-item[\s\S]*grid-template-columns: minmax\(0, auto\) max-content/);
  assert.match(css, /\.usage-compact-item__label/);
  assert.match(css, /\.usage-compact-item__value/);
  assert.match(css, /\.agent-usage--compact/);
  assert.match(css, /\.agent-usage--compact[\s\S]*padding: 6px 0 8px/);
  assert.match(css, /\.agent-usage--compact \.agent-usage__full[\s\S]*max-height: 0/);
  assert.match(css, /\.agent-usage--compact \.agent-usage__full[\s\S]*opacity: 0/);
  assert.match(css, /\.agent-usage--compact \.usage-compact-row[\s\S]*max-height: 48px/);
  assert.match(css, /\.agent-usage--compact \.usage-compact-row[\s\S]*opacity: 1/);
  assert.doesNotMatch(css, /\.agent-usage--compact \.usage-card[\s\S]*min-height: 56px/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(104px, 1fr\)\)/);
  assert.match(css, /\.usage-card__value/);
  assert.doesNotMatch(css, /\.usage-card__unit/);
  assert.match(css, /\.context-usage-card/);
  assert.match(css, /\.context-usage-card::after/);
  assert.match(css, /\.context-usage-card:hover::after/);
  assert.match(css, /\.context-donut/);
  assert.match(css, /\.context-donut span[\s\S]*font-size: 12px/);
  assert.match(css, /\.context-donut__cap/);
  assert.match(css, /\.context-donut__cap[\s\S]*border-radius: 50%/);
  assert.match(css, /\.context-donut__cap[\s\S]*transform: rotate\(var\(--context-cap-angle\)\) translateY\(-21px\)/);
  assert.match(css, /conic-gradient/);
  assert.doesNotMatch(css, /\.context-meter/);
  assert.match(css, /\.trace-stats[\s\S]*grid-template-columns: repeat\(3, minmax\(92px, 1fr\)\)/);
  assert.doesNotMatch(css, /\.trace-summary[\s\S]*minmax\(118px, auto\)/);
  assert.match(css, /\.trace-path[\s\S]*text-overflow: ellipsis/);
  assert.match(css, /\.trace-stats span[\s\S]*min-height: 92px/);
});

test("timeline usage strip compacts when it reaches sticky position", async () => {
  const js = await readFile("public/app.js", "utf8");
  const updateStickyUsageDensity = extractFunction(js, "updateStickyUsageDensity");
  const shouldRenderStickyUsageCompact = extractFunction(js, "shouldRenderStickyUsageCompact");
  const renderCompactUsageRow = extractFunction(js, "renderCompactUsageRow");

  assert.match(js, /let usageDensityFrame = 0/);
  assert.match(js, /const stickyUsageTop = 108/);
  assert.match(js, /window\.addEventListener\("scroll", scheduleStickyUsageUpdate, \{ passive: true \}\)/);
  assert.match(js, /window\.addEventListener\("resize", scheduleStickyUsageUpdate\)/);
  assert.match(js, /function scheduleStickyUsageUpdate\(\)/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(updateStickyUsageDensity, /panelEl\.querySelector\("\.agent-usage"\)/);
  assert.match(updateStickyUsageDensity, /getBoundingClientRect\(\)\.top <= stickyUsageTop \+ 1/);
  assert.match(updateStickyUsageDensity, /classList\.contains\("agent-usage--compact"\) !== compact/);
  assert.match(updateStickyUsageDensity, /classList\.toggle\("agent-usage--compact"/);
  assert.match(shouldRenderStickyUsageCompact, /panelEl\.querySelector\("\.agent-usage"\)/);
  assert.match(shouldRenderStickyUsageCompact, /classList\.contains\("agent-usage--compact"\)/);
  assert.match(shouldRenderStickyUsageCompact, /getBoundingClientRect\(\)\.top <= stickyUsageTop \+ 1/);
  assert.match(renderCompactUsageRow, /class="usage-compact-row"/);
  assert.match(renderCompactUsageRow, /renderCompactUsageItem\("Context window", formatContextPercent\(usage\.current\)\)/);
  assert.match(renderCompactUsageRow, /getTokenUsageRows\(usage\.total\)\.map/);
  assert.match(js, /class="usage-compact-item"/);
  assert.match(js, /class="usage-compact-item__label"/);
  assert.match(js, /class="usage-compact-item__value"/);
});

test("events view owns raw event stream and raw JSON expansion", async () => {
  const js = await readFile("public/app.js", "utf8");
  const renderEvents = extractFunction(js, "renderEvents");

  assert.match(renderEvents, /\/api\/sessions\/\$\{encodeURIComponent\(threadId\)\}\/timeline/);
  assert.match(renderEvents, /Raw events/);
  assert.match(renderEvents, /eventRecords\.slice\(-120\)/);
  assert.match(renderEvents, /data-raw/);
  assert.match(renderEvents, /\/api\/events\/\$\{button\.dataset\.raw\}\/raw/);
  assert.match(renderEvents, /JSON\.parse\(raw\.rawJson\)/);
});

test("subagents view renders compact cards in a multi-column grid", async () => {
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");
  const renderSubagents = extractFunction(js, "renderSubagents");

  assert.match(renderSubagents, /\/api\/sessions\/\$\{encodeURIComponent\(threadId\)\}\/subagents/);
  assert.doesNotMatch(renderSubagents, /Promise\.all\(\[/);
  assert.doesNotMatch(renderSubagents, /\/usage/);
  assert.match(renderSubagents, /renderSubagentCard\(edge\)/);
  assert.match(renderSubagents, /keydown/);
  assert.doesNotMatch(js, /function renderSubagentOverview/);
  assert.doesNotMatch(js, /function getSubagentUsage/);
  assert.doesNotMatch(js, /function formatSubagentContext/);
  assert.doesNotMatch(js, /function renderSubagentMetric/);
  assert.doesNotMatch(js, /class="subagents-overview"/);
  assert.match(js, /class="subagent-list"/);
  assert.match(js, /class="subagent-card__meta"/);
  assert.match(js, /class="subagent-card__session"/);
  assert.match(js, /Child session/);
  assert.match(js, /role="button"/);
  assert.match(js, /tabindex="0"/);
  assert.doesNotMatch(js, />Open</);
  assert.doesNotMatch(js, /<button class="secondary compact" data-child/);
  assert.doesNotMatch(js, /class="subagent-metrics"/);
  assert.doesNotMatch(js, /class="subagent-stat"/);
  assert.doesNotMatch(css, /\.subagents-overview/);
  assert.match(css, /\.subagent-list/);
  assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(220px, 1fr\)\)/);
  assert.match(css, /\.subagent-card[\s\S]*min-height: 132px/);
  assert.match(css, /\.subagent-card--clickable/);
  assert.match(css, /\.subagent-card__session/);
  assert.doesNotMatch(css, /\.subagent-card button/);
  assert.doesNotMatch(css, /\.subagent-metrics/);
  assert.doesNotMatch(css, /\.subagent-stat/);
  assert.doesNotMatch(css, /grid-row: 1 \/ span 4/);
});

function getRenderMarkdown(source: string): (value: string) => string {
  const functions = [
    "escapeHtml",
    "isSafeMarkdownHref",
    "unescapeDirectiveString",
    "parseDirectiveAttributes",
    "parseCodexDirective",
    "formatCodexDirectiveName",
    "renderCodexDirective",
    "parseCodeCommentDirective",
    "formatCodeCommentLocation",
    "renderCodeComment",
    "renderMemoryCitation",
    "parseSubagentNotification",
    "renderSubagentNotification",
    "isCodexBlockTag",
    "parseCodexBlock",
    "parseCodexBlockBoundary",
    "renderCodexBlock",
    "isImageAttachmentPath",
    "parseFileAttachmentText",
    "parseImageDirective",
    "renderImageAttachment",
    "renderInlineMarkdown",
    "renderMarkdown",
  ];
  const code = [
    ...functions.map((name) => extractFunction(source, name)),
    "renderMarkdown;",
  ].join("\n");
  return vm.runInNewContext(code) as (value: string) => string;
}

function extractFunction(source: string, name: string): string {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart === -1 ? source.indexOf(`function ${name}(`) : asyncStart;
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

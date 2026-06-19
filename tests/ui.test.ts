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
  const code = [
    extractFunction(js, "escapeHtml"),
    extractFunction(js, "isSafeMarkdownHref"),
    extractFunction(js, "unescapeDirectiveString"),
    extractFunction(js, "parseDirectiveAttributes"),
    extractFunction(js, "parseCodeCommentDirective"),
    extractFunction(js, "formatCodeCommentLocation"),
    extractFunction(js, "renderCodeComment"),
    extractFunction(js, "renderMemoryCitation"),
    extractFunction(js, "renderInlineMarkdown"),
    extractFunction(js, "renderMarkdown"),
    "renderMarkdown;",
  ].join("\n");
  const renderMarkdown = vm.runInNewContext(code) as (value: string) => string;

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
  const code = [
    extractFunction(js, "escapeHtml"),
    extractFunction(js, "isSafeMarkdownHref"),
    extractFunction(js, "unescapeDirectiveString"),
    extractFunction(js, "parseDirectiveAttributes"),
    extractFunction(js, "parseCodeCommentDirective"),
    extractFunction(js, "formatCodeCommentLocation"),
    extractFunction(js, "renderCodeComment"),
    extractFunction(js, "renderMemoryCitation"),
    extractFunction(js, "renderInlineMarkdown"),
    extractFunction(js, "renderMarkdown"),
    "renderMarkdown;",
  ].join("\n");
  const renderMarkdown = vm.runInNewContext(code) as (value: string) => string;

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
  assert.match(js, /\/api\/sessions\/\$\{encodeURIComponent\(selected\)\}\/usage/);
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

  assert.match(renderEvents, /\/api\/sessions\/\$\{encodeURIComponent\(selected\)\}\/timeline/);
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

  assert.match(renderSubagents, /\/api\/sessions\/\$\{encodeURIComponent\(selected\)\}\/subagents/);
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

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
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

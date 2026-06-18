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
  assert.doesNotMatch(js, /renderStats/);
  assert.match(js, /Promise\.all\(\[/);
  assert.match(js, /\/api\/sessions\/\$\{encodeURIComponent\(selected\)\}\/usage/);
  assert.match(js, /renderAgentUsage\(usage\)/);
  assert.doesNotMatch(renderTimeline, /renderSessionHero\(data\.session,[\s\S]*usage\.current/);
  assert.match(js, /renderSessionKind\(session\)/);
  assert.match(js, /Main session/);
  assert.match(js, /Subagent/);
  assert.match(js, /function renderAgentUsage\(usage = \{\}\) \{[\s\S]*renderContextUsageCard\(usage\.current\)/);
  assert.match(js, /function renderAgentUsage\(usage = \{\}\) \{[\s\S]*renderTokenBreakdown\(usage\.total\)/);
  assert.match(js, /function renderTokenBreakdown/);
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

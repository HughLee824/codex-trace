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
  assert.match(js, /selectSession\(button\.dataset\.child, "timeline"\)/);
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

test("timeline renders usage under the session hero without a stats tab", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");
  const css = await readFile("public/styles.css", "utf8");

  assert.doesNotMatch(html, /data-tab="stats"/);
  assert.doesNotMatch(js, /renderStats/);
  assert.match(js, /Promise\.all\(\[/);
  assert.match(js, /\/api\/sessions\/\$\{encodeURIComponent\(selected\)\}\/usage/);
  assert.match(js, /renderAgentUsage\(usage\)/);
  assert.match(js, /renderSessionHero\(data\.session,[\s\S]*usage\.current/);
  assert.match(js, /renderSessionKind\(session\)/);
  assert.match(js, /Main session/);
  assert.match(js, /Subagent/);
  assert.match(js, /renderTokenBreakdown\(usage\.total\)/);
  assert.match(js, /function renderTokenBreakdown/);
  assert.match(js, /function renderContextDonut/);
  assert.doesNotMatch(js, /function renderCurrentContextUsage/);
  assert.doesNotMatch(js, /function renderContextChart/);
  assert.doesNotMatch(js, /<h3>Token usage<\/h3>/);
  assert.doesNotMatch(js, /<h3>Context usage<\/h3>/);
  assert.doesNotMatch(js, /current agent/);
  assert.doesNotMatch(js, /Current agent/);
  assert.match(js, /class="context-donut"/);
  assert.match(js, /class="context-title">Context/);
  assert.match(css, /\.usage-grid/);
  assert.match(css, /\.context-donut/);
  assert.match(css, /conic-gradient/);
  assert.match(css, /\.trace-summary[\s\S]*grid-template-columns: repeat\(3, minmax\(92px, 1fr\)\) minmax\(118px, auto\)/);
  assert.match(css, /\.trace-path[\s\S]*text-overflow: ellipsis/);
  assert.match(css, /\.trace-stats span[\s\S]*min-height: 92px/);
  assert.match(css, /\.trace-context[\s\S]*min-height: 104px/);
  assert.match(css, /\.context-title[\s\S]*font-size: 11px/);
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

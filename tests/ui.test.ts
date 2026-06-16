import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

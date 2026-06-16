import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";

test("package metadata is ready for public npm publishing", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.description, "Local web UI for inspecting Codex session traces, tool calls, and subagents.");
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/HughLee824/codex-trace.git",
  });
  assert.deepEqual(packageJson.bin, { "codex-trace": "bin/codex-trace.js" });
  assert.deepEqual(packageJson.publishConfig, { access: "public" });
  assert.ok(packageJson.keywords.includes("codex"));
  assert.ok(packageJson.keywords.includes("trace"));
  assert.ok(packageJson.files.includes("bin"));
  assert.ok(packageJson.files.includes("src"));
  assert.ok(packageJson.files.includes("public"));
  assert.ok(packageJson.files.includes("README.md"));
  assert.ok(packageJson.files.includes("LICENSE"));
});

test("npm publish workflow uses trusted publishing from release tags", async () => {
  const workflow = await readFile(".github/workflows/publish.yml", "utf8");

  assert.match(workflow, /name: Publish Package/);
  assert.match(workflow, /tags:\s*\n\s+- "v\*"/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /uses: actions\/checkout@v6/);
  assert.match(workflow, /uses: actions\/setup-node@v6/);
  assert.match(workflow, /node-version: "24\.x"/);
  assert.match(workflow, /registry-url: "https:\/\/registry\.npmjs\.org"/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build --if-present/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run pack:dry-run/);
  assert.match(workflow, /v\$\(node -p "require\('\.\/package\.json'\)\.version"\)/);
  assert.match(workflow, /npm publish/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});

test("npm bin wrapper launches the TypeScript CLI through Node", async () => {
  const wrapper = await readFile("bin/codex-trace.js", "utf8");
  const wrapperStat = await stat("bin/codex-trace.js");

  assert.match(wrapper, /^#!\/usr\/bin\/env node/);
  assert.match(wrapper, /--experimental-strip-types/);
  assert.match(wrapper, /"src", "cli\.ts"/);
  assert.notEqual(wrapperStat.mode & 0o111, 0);
});

test("open-source docs and Apache license are present", async () => {
  await access("README.md", constants.R_OK);
  await access("LICENSE", constants.R_OK);

  const readme = await readFile("README.md", "utf8");
  const license = await readFile("LICENSE", "utf8");

  assert.match(readme, /npm install -g codex-trace/);
  assert.match(readme, /codex-trace serve/);
  assert.match(readme, /Privacy/);
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0, January 2004/);
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("version command prints the package version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "version"]);

  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

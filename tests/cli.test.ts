import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("version command prints the package version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "version"], {
    env: cliTestEnv(),
  });

  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

test("update command self-updates the global npm package", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-trace-update-"));
  const npmShim = join(dir, "npm");
  const argsPath = join(dir, "npm-args.json");
  await writeFile(
    npmShim,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
      "process.exit(0);",
    ].join("\n"),
  );
  await chmod(npmShim, 0o755);

  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "update"], {
    env: cliTestEnv({ HOME: dir, PATH: `${dir}:${process.env.PATH ?? ""}` }),
  });

  assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), ["install", "-g", "codex-trace@latest"]);
  assert.match(result.stdout, /Updating codex-trace/);
  assert.equal(result.stderr, "");
});

function cliTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, NODE_NO_WARNINGS: "1", ...overrides };
}

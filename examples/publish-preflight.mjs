import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = (command, args, { required = true } = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (required && result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
};

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(pkg.name, "iroharness");
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);

run("node", ["examples/oss-readiness-check.mjs"], { required: true });

const remote = run("git", ["remote", "-v"]);
assert.match(
  remote.stdout,
  /github\.com[:/]iroharness\/iroharness/,
  "Git remote must point to github.com/iroharness/iroharness"
);

const status = run("git", ["status", "--short"]);
assert.equal(status.stdout.trim(), "", "Working tree must be clean before publishing");

const tag = `v${pkg.version}`;
const tagCheck = run("git", ["rev-parse", "--verify", tag], { required: false });
assert.notEqual(tagCheck.status, 0, `${tag} already exists; bump package.json version first`);

run("gh", ["auth", "status"]);
run("npm", ["whoami"]);

console.log(
  JSON.stringify(
    {
      ok: true,
      package: pkg.name,
      version: pkg.version,
      tag,
      remote: remote.stdout.trim().split(/\r?\n/)[0]
    },
    null,
    2
  )
);

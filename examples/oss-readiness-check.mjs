import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const run = (command, args) =>
  spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });

const pkg = JSON.parse(read("package.json"));
const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "RELEASE.md",
  "ROADMAP.md"
];
const requiredPackageFiles = [
  "bin",
  "src",
  "crates",
  "fixtures",
  "protocols",
  "docs",
  "examples",
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "RELEASE.md",
  "ROADMAP.md"
];

requiredFiles.forEach((file) => {
  assert.equal(existsSync(file), true, `${file} should exist`);
});
requiredPackageFiles.forEach((file) => {
  assert.equal(pkg.files.includes(file), true, `package files should include ${file}`);
});

assert.equal(pkg.license, "MIT");
assert.equal(pkg.type, "module");
assert.equal(Boolean(pkg.bin?.iroharness), true);
assert.equal(Boolean(pkg.exports?.["."]), true);
assert.equal(Boolean(pkg.exports?.["./adapters"]), true);
assert.equal(Boolean(pkg.exports?.["./testing"]), true);
assert.match(pkg.repository?.url || "", /github\.com\/iroharness\/iroharness/);
assert.match(pkg.scripts.verify, /npm run check && npm test/);
assert.match(pkg.scripts["package:dry-run"], /npm pack --dry-run/);
assert.match(pkg.scripts["smoke:generated-app"], /generated-app-smoke-test/);
assert.match(pkg.scripts["e2e:browser-screenshots"], /browser-screenshot-check/);

const tracked = run("git", ["ls-files"]);
assert.equal(tracked.status, 0, tracked.stderr);
const trackedFiles = tracked.stdout.split(/\r?\n/).filter(Boolean);
trackedFiles.forEach((file) => {
  assert.equal(
    file === ".env" || (file.startsWith(".env.") && file !== ".env.example"),
    false,
    `${file} must not be tracked`
  );
  assert.equal(file.startsWith(".iroharness/"), false, `${file} must not be tracked`);
});

const ci = read(join(".github", "workflows", "ci.yml"));
const release = read(join(".github", "workflows", "release.yml"));
assert.match(ci, /npm run verify/);
assert.match(ci, /npm run package:dry-run/);
assert.match(ci, /npm run smoke:generated-app/);
assert.match(ci, /cargo test -p iroharness-realtime-core/);
assert.match(ci, /wasm32-unknown-unknown/);
assert.match(release, /npm publish --provenance --access public/);
assert.match(release, /NPM_TOKEN/);
assert.match(release, /npm run smoke:generated-app/);

const remote = run("git", ["remote", "-v"]);
const remotes = remote.status === 0 ? remote.stdout.trim() : "";
if (process.env.IROHARNESS_REQUIRE_GIT_REMOTE === "1") {
  assert.match(remotes, /github\.com[:/]iroharness\/iroharness/, "GitHub remote is required");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      package: pkg.name,
      version: pkg.version,
      files: pkg.files.length,
      trackedFiles: trackedFiles.length,
      remoteConfigured: remotes.length > 0,
      strictRemote: process.env.IROHARNESS_REQUIRE_GIT_REMOTE === "1"
    },
    null,
    2
  )
);

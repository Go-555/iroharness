# Extension Model — Phase 3-B (View-Export Skill Materialization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `iroharness view export --zone <zone>` materialize only view-visible skills, so a `public`/`trusted` export never carries higher-zone skills on disk.

**Architecture:** Add `exportSkillFiles({ sourceRoot, targetRoot, zone, files })` to `bin/iroharness.mjs`, called from `exportView` alongside the existing `exportMemoryFiles`/`exportProjectOsFiles`. It discovers skill directories directly (built-in `defaultBuiltInSkillDir()` + app-local `<sourceRoot>/.iroharness/skills/`), reads each skill's **normalized** view via the exported `readSkillGating` (gate.js's fail-closed normalizer), and copies the skill directory into `current/skills/<id>/` iff `viewZoneRank[gating.view] <= viewZoneRank[zone]`. View-layer only — `capability`/`requires` are not applied at export.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. The CLI is exercised end-to-end via the existing `runCli` spawn helper in `test/cli.test.js`.

**Spec:** `docs/extension-model.md` §4.4 (reconciled and independently reviewed).

**Scope:** Phase 3-B only — the view-export skill filter. The hook throw-policy (§6) stays deferred to the command runner (Phase 4); the realtime-invariant hardening tests already landed separately.

**Key grounding facts (verified against the code):**
- `exportView` (bin/iroharness.mjs ~1462) copies SOUL/identity/voice, then calls `exportMemoryFiles`/`exportProjectOsFiles`/`exportConnectionFiles`, writes policies, then the `view-manifest.json` (its `files` array is built from the `files` list each export* helper pushes to).
- `viewZoneRank = { public: 0, trusted: 1, owner: 2 }` already exists (~1334); reuse it.
- `copyViewFile` uses `cpSync(source, target, { recursive: true })` — directories copy whole. For skills we copy the skill dir directly with `cpSync` since the built-in skill dir is **outside** `sourceRoot` (copyViewFile only joins paths under `sourceRoot`).
- `readSkillGating({ id, metadata: { manifestPath } })` (exported from `src/skills/index.js`) returns `{ view: <normalized>, capability, requires }` and **throws** if `manifestPath` is missing or the `SKILL.md` frontmatter is malformed (unclosed). So `exportSkillFiles` needs its **own** try/catch per skill to honor "malformed skipped, never aborts."
- **Why direct dir discovery, not `createFileSkillRegistry`:** the registry's `readSkillDirManifests` maps `readSkillMarkdownManifest` over every `SKILL.md` and is **not** defensive — one malformed skill throws the whole `snapshot()`, which would abort the export. Discovering directories directly lets us catch per-skill.
- Test pattern: `test/cli.test.js` `runCli([...])` (line 15) spawns the real binary; the existing `CLI view export creates zone-limited runtime views` test (line 567) shows the `init` → write files → `view export --zone` → read manifest flow.

---

## File Structure

- Modify `bin/iroharness.mjs` — add the import of `readSkillGating` and `defaultBuiltInSkillDir`, add `exportSkillFiles`, call it in `exportView`.
- Modify `test/cli.test.js` — add the view-export-skills integration test(s), reusing `runCli`.
- `docs/extension-model.md` §4.4/§8 already describe this (Approved); confirm no further doc change needed beyond marking done.

Test command (this file): `node --test test/cli.test.js`
Full suite: `npm test`

---

## Task 1: `exportSkillFiles` — per-zone view filtering, wired into `exportView`

**Files:**
- Modify: `bin/iroharness.mjs`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/cli.test.js`:

```js
test("CLI view export materializes only view-visible skills per zone", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-view-skills-"));
  const appDir = join(dir, "companion");
  runCli(["init", appDir, "--character", "Iroha"]);

  const skillsRoot = join(appDir, ".iroharness", "skills");
  const writeSkill = (id, extraFrontmatter) => {
    mkdirSync(join(skillsRoot, id), { recursive: true });
    writeFileSync(
      join(skillsRoot, id, "SKILL.md"),
      `---\nname: ${id}\ndescription: test skill ${id}.\n${extraFrontmatter}---\n\n# ${id}\n`,
      "utf8",
    );
  };
  writeSkill("pub-greet", "view: public\n");
  writeSkill("trust-ops", "view: trusted\ncapability: delegate_work\n"); // capability-gated
  writeSkill("owner-secret", "view: owner\n");
  writeSkill("ungated", ""); // no view -> fail-closed owner

  const exportZone = (zone) => {
    const out = join(dir, `${zone}-view`);
    const result = runCli(["view", "export", appDir, "--zone", zone, "--out", out, "--force"]);
    assert.equal(result.status, 0, result.stderr);
    return join(out, "current", "skills");
  };

  const pub = exportZone("public");
  assert.equal(existsSync(join(pub, "pub-greet", "SKILL.md")), true);
  assert.equal(existsSync(join(pub, "trust-ops")), false);
  assert.equal(existsSync(join(pub, "owner-secret")), false);
  assert.equal(existsSync(join(pub, "ungated")), false); // fail-closed: no view -> owner

  const trusted = exportZone("trusted");
  assert.equal(existsSync(join(trusted, "pub-greet", "SKILL.md")), true);
  assert.equal(existsSync(join(trusted, "trust-ops", "SKILL.md")), true); // capability-gated still materialized by view
  assert.equal(existsSync(join(trusted, "owner-secret")), false);
  assert.equal(existsSync(join(trusted, "ungated")), false);

  const owner = exportZone("owner");
  assert.equal(existsSync(join(owner, "owner-secret", "SKILL.md")), true);
  assert.equal(existsSync(join(owner, "ungated", "SKILL.md")), true); // no-view materialized only here
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="materializes only view-visible skills" test/cli.test.js`
Expected: FAIL — `current/skills` does not exist (export does not materialize skills yet).

- [ ] **Step 3: Write minimal implementation**

In `bin/iroharness.mjs`:

1. Extend the import from `../src/skills/index.js` (currently imports `createFileSkillRegistry`, `defaultIroHarnessSkillDir`, ...) to also import `readSkillGating` and `defaultBuiltInSkillDir`.
2. Add `readdirSync` and `statSync` to the `node:fs` import — neither is present today. Change the current line:
   `import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";`
   to:
   `import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";`
3. Add the helper near the other `export*` helpers (after `exportConnectionFiles`):

```js
const exportSkillFiles = ({ sourceRoot, targetRoot, zone, files }) => {
  const zoneRank = viewZoneRank[zone];
  const skillRoots = [
    defaultBuiltInSkillDir(),
    join(sourceRoot, ".iroharness", "skills"),
  ];
  for (const root of skillRoots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root)) {
      const skillDir = join(root, entry);
      const manifestPath = join(skillDir, "SKILL.md");
      if (!statSync(skillDir).isDirectory() || !existsSync(manifestPath)) {
        continue;
      }
      let gating;
      try {
        gating = readSkillGating({ id: entry, metadata: { manifestPath } });
      } catch (error) {
        console.warn(
          `[view export] skipping unreadable skill ${entry}: ${error.message}`,
        );
        continue;
      }
      if (viewZoneRank[gating.view] > zoneRank) {
        continue; // not visible in this zone
      }
      const targetPath = join("skills", entry);
      cpSync(skillDir, join(targetRoot, targetPath), { recursive: true });
      files.push(targetPath);
    }
  }
};
```

4. Call it in `exportView`, right after `exportConnectionFiles(...)`:

```js
  exportSkillFiles({ sourceRoot, targetRoot: currentRoot, zone, files });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="materializes only view-visible skills" test/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/iroharness.mjs test/cli.test.js
git commit -m "feat(view): materialize only view-visible skills on export"
```

---

## Task 2: Malformed `SKILL.md` is skipped, export still succeeds

**Files:**
- Test: `test/cli.test.js`
- (No new impl expected — Task 1's per-skill try/catch should already handle this. This task proves it.)

- [ ] **Step 1: Write the failing test**

Add:

```js
test("CLI view export skips a malformed skill without aborting", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-view-skills-bad-"));
  const appDir = join(dir, "companion");
  runCli(["init", appDir, "--character", "Iroha"]);
  const skillsRoot = join(appDir, ".iroharness", "skills");

  mkdirSync(join(skillsRoot, "good"), { recursive: true });
  writeFileSync(
    join(skillsRoot, "good", "SKILL.md"),
    "---\nname: good\ndescription: a good public skill.\nview: public\n---\n\n# good\n",
    "utf8",
  );
  // Unclosed frontmatter -> parseSkillFrontmatter throws -> must be skipped.
  mkdirSync(join(skillsRoot, "broken"), { recursive: true });
  writeFileSync(
    join(skillsRoot, "broken", "SKILL.md"),
    "---\nname: broken\ndescription: malformed.\n\n# broken\n",
    "utf8",
  );

  const out = join(dir, "public-view");
  const result = runCli(["view", "export", appDir, "--zone", "public", "--out", out, "--force"]);
  assert.equal(result.status, 0, result.stderr); // export did not abort
  const skills = join(out, "current", "skills");
  assert.equal(existsSync(join(skills, "good", "SKILL.md")), true);
  assert.equal(existsSync(join(skills, "broken")), false); // malformed skipped
});
```

- [ ] **Step 2: Run test to verify it passes (or fails)**

Run: `node --test --test-name-pattern="skips a malformed skill" test/cli.test.js`
Expected: PASS if Task 1's per-skill try/catch is correct. If it FAILS (export aborts / status != 0), the catch is missing or mis-scoped — fix `exportSkillFiles` so `readSkillGating` errors are caught per skill, then re-run.

- [ ] **Step 3: Commit**

```bash
git add test/cli.test.js
git commit -m "test(view): malformed skill is skipped, export does not abort"
```

---

## Task 3: Materialized skills are listed in the view manifest

**Files:**
- Test: `test/cli.test.js`

The `files` array we push to is what `view-manifest.json`'s `files` is built from, so materialized skills should appear there.

- [ ] **Step 1: Write the failing/confirming test**

Add:

```js
test("CLI view export lists materialized skills in the manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-view-skills-manifest-"));
  const appDir = join(dir, "companion");
  runCli(["init", appDir, "--character", "Iroha"]);
  const skillsRoot = join(appDir, ".iroharness", "skills");
  mkdirSync(join(skillsRoot, "pub-greet"), { recursive: true });
  writeFileSync(
    join(skillsRoot, "pub-greet", "SKILL.md"),
    "---\nname: pub-greet\ndescription: public.\nview: public\n---\n\n# pub-greet\n",
    "utf8",
  );

  const out = join(dir, "public-view");
  runCli(["view", "export", appDir, "--zone", "public", "--out", out, "--force"]);
  const manifest = JSON.parse(
    readFileSync(join(out, "current", "view-manifest.json"), "utf8"),
  );
  assert.equal(manifest.files.includes(join("skills", "pub-greet")), true);
});
```

- [ ] **Step 2: Run test**

Run: `node --test --test-name-pattern="lists materialized skills in the manifest" test/cli.test.js`
Expected: PASS (the `files.push(targetPath)` in `exportSkillFiles` feeds the manifest).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: full suite green, no regressions. The existing `CLI view export creates zone-limited runtime views` test (line 567) does only `public` and `trusted` exports and uses `.includes()` checks (not an exact-list `deepEqual`). The three repo built-in skills all lack a `view:` field → fail-closed to `owner`, so they are NOT materialized in public/trusted exports — that test stays skill-free and unaffected. Only an `owner`-zone export would materialize the built-ins; the Task 1 owner assertions check specific app-local ids (`owner-secret`, `ungated`) and tolerate the extra built-in `skills/` entries.

- [ ] **Step 4: Mark the spec done and commit**

In `docs/extension-model.md` §4.4, change the opening "It does **not** yet materialize skills" framing is now historical — leave the design text as-is (it describes the now-shipped behavior) and update §8 item 3 from "**This phase.**" to "**Done.**".

```bash
git add test/cli.test.js docs/extension-model.md
git commit -m "test(view): manifest lists materialized skills; mark §8 phase 3 done"
```

---

## Done When

- [ ] `node --test test/cli.test.js` passes, including the three new view-export-skill tests.
- [ ] `npm test` passes with no regressions.
- [ ] `public`/`trusted` exports never contain higher-zone or un-annotated (fail-closed→owner) skills on disk; `owner` contains all.
- [ ] A malformed `SKILL.md` is skipped with a warning and does not abort the export.
- [ ] `bin/iroharness.mjs` reuses `readSkillGating` (gate.js's normalizer) — no second copy of the view alias/fail-closed logic.

## Follow-on (not this plan)

- **Phase 4:** command runner (text-path hook gates) **+** the hook throw-policy (§6) — the fail-closed/fail-open catch lands with `dispatch`'s first real loop consumer.
- **Phase 5:** agent runner (response review).
- **transform×authz guard:** when hooks are wired into the turn pipeline and `ctx.actor` carries authz, wall protected keys off from `transform`.

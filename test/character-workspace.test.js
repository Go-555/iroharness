import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCharacterWorkspace } from "../src/index.js";

const makeWorkspace = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "iroha-workspace-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return dir;
};

const fixedNow = (iso) => () => new Date(iso);

test("loadCharacterWorkspace loads persona files plus today and yesterday daily notes", () => {
  const dir = makeWorkspace({
    "SOUL.md": "soul text",
    "IDENTITY.md": "identity text",
    "VOICE.md": "soft voice",
    "MEMORY.md": "long-term memory",
    "memory/2026-06-12.md": "today note",
    "memory/2026-06-11.md": "yesterday note",
    "memory/2026-06-10.md": "older note that must not load"
  });
  try {
    const character = loadCharacterWorkspace({
      dir,
      id: "iroha",
      name: "橙花いろは",
      now: fixedNow("2026-06-12T10:00:00+09:00")
    });
    assert.equal(character.id, "iroha");
    assert.equal(character.name, "橙花いろは");
    assert.equal(character.soul, "soul text");
    assert.equal(character.identity, "identity text");
    assert.equal(character.voiceStyle, "soft voice");
    assert.match(character.memory, /long-term memory/);
    assert.match(character.memory, /## Daily notes 2026-06-11\n[\s\S]*yesterday note/);
    assert.match(character.memory, /## Daily notes 2026-06-12\n[\s\S]*today note/);
    assert.doesNotMatch(character.memory, /older note/);
    assert.ok(
      character.memory.indexOf("long-term memory") <
        character.memory.indexOf("2026-06-11"),
      "long-term memory comes before daily notes"
    );
    assert.ok(
      character.memory.indexOf("2026-06-11") <
        character.memory.indexOf("2026-06-12"),
      "daily notes are chronological"
    );
    assert.ok(Object.isFrozen(character));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCharacterWorkspace works with long-term memory only", () => {
  const dir = makeWorkspace({ "SOUL.md": "soul", "MEMORY.md": "facts" });
  try {
    const character = loadCharacterWorkspace({
      dir,
      now: fixedNow("2026-06-12T10:00:00+09:00")
    });
    assert.equal(character.memory, "facts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCharacterWorkspace works with a daily note and no MEMORY.md", () => {
  const dir = makeWorkspace({
    "SOUL.md": "soul",
    "memory/2026-06-12.md": "only today"
  });
  try {
    const character = loadCharacterWorkspace({
      dir,
      now: fixedNow("2026-06-12T23:59:00+09:00")
    });
    assert.match(character.memory, /## Daily notes 2026-06-12\n[\s\S]*only today/);
    assert.doesNotMatch(character.memory, /undefined|null/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCharacterWorkspace computes yesterday across month boundaries in local time", () => {
  const dir = makeWorkspace({
    "SOUL.md": "soul",
    "memory/2026-02-28.md": "end of february"
  });
  try {
    const character = loadCharacterWorkspace({
      dir,
      now: fixedNow("2026-03-01T00:30:00+09:00")
    });
    assert.match(character.memory, /end of february/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCharacterWorkspace requires dir", () => {
  assert.throws(() => loadCharacterWorkspace({}), /dir/);
});

// ajimi (boundary fixation): parametrized edge cases for the single recipe-id
// validator (Fix 3). These tests pin the CURRENT semantics so a future change
// to the pattern is a conscious decision, not an accident.
//
// Note on "..": ids containing ".." in the MIDDLE or at the END (e.g.
// "foo..bar", "foo..") are accepted by design — an id is always used as a
// single path segment ("/" and "\\" are rejected), so an embedded ".." cannot
// traverse anywhere. Only a LEADING dot (which covers "..foo", ".", "..") is
// rejected, because the pattern requires an alphanumeric first character.

import assert from "node:assert/strict";
import test from "node:test";

import { assertValidRecipeId } from "../src/agent-bank/ids.js";

const REJECTED = [
  // traversal / separators
  "..",
  ".",
  "../escape",
  "a/b",
  "a\\b",
  // leading dot (hidden files, "..foo")
  ".hidden",
  "..foo",
  // unicode / whitespace (single-script ASCII ids only)
  "日本語",
  "foo bar",
  // null byte (filesystem poison)
  "foo\0bar",
  // non-strings
  null,
  undefined,
  42,
  {},
  ["a"],
  // empty
  "",
];

const ACCEPTED = [
  "tax-v3",
  "a",
  "A9",
  "a.b",
  "a_b-c.d",
  // ".." embedded in a single path segment cannot traverse (see note above)
  "foo..bar",
  "foo..",
];

test("assertValidRecipeId rejects malformed ids (parametrized)", () => {
  for (const id of REJECTED) {
    assert.throws(
      () => assertValidRecipeId(id),
      /invalid recipe id/i,
      `expected rejection for ${JSON.stringify(String(id))}`,
    );
  }
});

test("assertValidRecipeId accepts safe single-segment ids (parametrized)", () => {
  for (const id of ACCEPTED) {
    assert.equal(assertValidRecipeId(id), id);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schemaPath = join(process.cwd(), "protocols", "sql", "postgres-audience.sql");

test("Postgres audience schema defines canonical identity and permission tables", () => {
  const sql = readFileSync(schemaPath, "utf8");

  [
    "iroharness_users",
    "iroharness_user_identities",
    "iroharness_permission_overrides",
    "iroharness_stream_sessions"
  ].forEach((table) => {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  });

  assert.match(sql, /unique \(platform, platform_user_id\)/);
  assert.match(sql, /unique \(user_id, permission, scope\)/);
  assert.match(sql, /role in \('owner', 'developer', 'moderator', 'member', 'fan', 'anonymous'\)/);
  assert.match(sql, /permission in \('chat_public', 'deep_discussion', 'delegate_work', 'manage_stream', 'manage_users'\)/);
  assert.match(sql, /status in \('live', 'paused', 'ended'\)/);
});

test("Postgres audience schema exposes a resolved user view for platform lookup hydration", () => {
  const sql = readFileSync(schemaPath, "utf8");

  assert.match(sql, /create or replace view iroharness_resolved_users as/);
  assert.match(sql, /jsonb_object_agg\(i\.platform, i\.platform_user_id\)/);
  assert.match(sql, /left join iroharness_user_identities i on i\.user_id = u\.id/);
});

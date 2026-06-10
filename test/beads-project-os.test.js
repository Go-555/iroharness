import { test } from "node:test";
import assert from "node:assert/strict";

import {
  beadsToSnapshot,
  createBeadsProjectOs,
} from "../src/beads-project-os.js";
import { computeLedger } from "../src/agent-bank/ledger.js";

// bd list --json の1要素（実機で確認した形）を ProjectOs の TicketRecord に写す。
test("beadsToSnapshot maps a bead to a ticket record", () => {
  const beads = [
    {
      id: "bd-x-n9p",
      title: "決算期の経費仕分け",
      description: "取引データを正しい勘定科目に振り分ける",
      acceptance_criteria: "人間レビューと95%一致",
      status: "open",
      issue_type: "task",
      metadata: {
        ownerCharacterId: "iroha",
        executorHarnessId: "tax-v3",
      },
      created_at: "2026-06-08T03:04:08Z",
      updated_at: "2026-06-08T03:04:08Z",
    },
  ];

  const snapshot = beadsToSnapshot(beads);

  assert.equal(snapshot.tickets.length, 1);
  const ticket = snapshot.tickets[0];
  assert.equal(ticket.id, "bd-x-n9p");
  assert.equal(ticket.title, "決算期の経費仕分け");
  assert.equal(ticket.purpose, "取引データを正しい勘定科目に振り分ける");
  assert.deepEqual(ticket.acceptance, ["人間レビューと95%一致"]);
  assert.equal(ticket.ownerCharacterId, "iroha");
  assert.equal(ticket.executorHarnessId, "tax-v3");
  assert.equal(ticket.status, "open");
  assert.equal(ticket.createdAt, "2026-06-08T03:04:08Z");
  assert.equal(ticket.updatedAt, "2026-06-08T03:04:08Z");
});

// close 時に bead.metadata.run へ畳んだ実行記録を runs[] に復元する。
// ledger は harnessId / status / output.qualityScore / updatedAt を読み、
// harness.test.js は runs[0].input.permissionCheck を読む（§3.1 ★）。
test("beadsToSnapshot derives a run from a closed bead's folded metadata", () => {
  const beads = [
    {
      id: "bd-x-n9p",
      title: "決算期の経費仕分け",
      description: "取引データを正しい勘定科目に振り分ける",
      acceptance_criteria: "人間レビューと95%一致",
      status: "closed",
      issue_type: "task",
      metadata: {
        ownerCharacterId: "iroha",
        executorHarnessId: "tax-v3",
        run: {
          id: "run-1",
          harnessId: "tax-v3",
          status: "completed",
          input: { text: "経費を仕分けて", permissionCheck: { allowed: true } },
          output: { status: "completed", qualityScore: 4.5 },
          createdAt: "2026-06-08T03:04:08Z",
          updatedAt: "2026-06-08T03:05:00Z",
        },
      },
      created_at: "2026-06-08T03:04:08Z",
      updated_at: "2026-06-08T03:05:00Z",
    },
  ];

  const snapshot = beadsToSnapshot(beads);

  assert.equal(snapshot.runs.length, 1);
  const run = snapshot.runs[0];
  assert.equal(run.id, "run-1");
  assert.equal(run.ticketId, "bd-x-n9p");
  assert.equal(run.harnessId, "tax-v3");
  assert.equal(run.status, "completed");
  assert.equal(run.input.permissionCheck.allowed, true);
  assert.equal(run.output.qualityScore, 4.5);
  assert.equal(run.updatedAt, "2026-06-08T03:05:00Z");
});

// run を畳んでいない bead（未委譲・未着手）からは run を出さない。
test("beadsToSnapshot yields no run for a bead without a folded run", () => {
  const beads = [
    {
      id: "bd-x-aaa",
      title: "まだ着手してない仕事",
      description: "...",
      status: "open",
      issue_type: "task",
      metadata: {},
      created_at: "2026-06-08T03:04:08Z",
      updated_at: "2026-06-08T03:04:08Z",
    },
  ];

  const snapshot = beadsToSnapshot(beads);

  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.runs.length, 0);
});

// B案の証明：子 bead 無しで（1委譲=1bead=1run）、同じ専門家が3つの別 bead で
// 完了すれば computeLedger の calls=3 に到達する。＝ 旧 BLOCK-1 は不要だった。
test("computeLedger over a beads-derived snapshot aggregates by harnessId", () => {
  const closedBead = (id, score) => ({
    id,
    title: "仕事",
    description: "...",
    status: "closed",
    issue_type: "task",
    metadata: {
      run: {
        id: `run-${id}`,
        harnessId: "tax-v3",
        status: "completed",
        input: { permissionCheck: { allowed: true } },
        output: { status: "completed", qualityScore: score },
        createdAt: "2026-06-08T03:04:08Z",
        updatedAt: `2026-06-08T03:0${Math.floor(score)}:00Z`,
      },
    },
    created_at: "2026-06-08T03:04:08Z",
    updated_at: "2026-06-08T03:05:00Z",
  });

  // 3つの別 ticket（別 bead）で、同じ専門家 tax-v3 が完了。
  const beads = [
    closedBead("bd-1", 4),
    closedBead("bd-2", 5),
    closedBead("bd-3", 3),
  ];

  const ledger = computeLedger(beadsToSnapshot(beads));

  assert.equal(ledger["tax-v3"].calls, 3);
  assert.equal(ledger["tax-v3"].success, 3);
  assert.equal(ledger["tax-v3"].avgScore, (4 + 5 + 3) / 3);
});

// createBeadsProjectOs: exec を注入。createTicket は `bd create --json` を叩き、
// 返った JSON を TicketRecord に写す。fake exec で bd を呼ばずに検証する。
test("createTicket runs `bd create --json` and returns a TicketRecord", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === "create") {
      return JSON.stringify({
        id: "bd-x-1",
        title: "経費を仕分けて",
        description: "取引データを勘定科目へ",
        acceptance_criteria: "95%一致",
        status: "open",
        issue_type: "task",
        metadata: { ownerCharacterId: "iroha", executorHarnessId: "tax-v3" },
        created_at: "2026-06-08T03:14:00Z",
        updated_at: "2026-06-08T03:14:00Z",
      });
    }
    return "";
  };

  const pos = createBeadsProjectOs({ exec });
  const ticket = pos.createTicket({
    title: "経費を仕分けて",
    purpose: "取引データを勘定科目へ",
    acceptance: ["95%一致"],
    ownerCharacterId: "iroha",
    executorHarnessId: "tax-v3",
  });

  // bd create --json を叩いている
  assert.equal(calls[0][0], "create");
  assert.ok(calls[0].includes("--json"), "passes --json");
  assert.ok(calls[0].includes("経費を仕分けて"), "passes the title");
  // メタデータに owner/executor を畳んでいる
  const metaIdx = calls[0].indexOf("--metadata");
  assert.ok(metaIdx >= 0, "passes --metadata");
  const meta = JSON.parse(calls[0][metaIdx + 1]);
  assert.equal(meta.ownerCharacterId, "iroha");
  assert.equal(meta.executorHarnessId, "tax-v3");
  // 返り値は TicketRecord
  assert.equal(ticket.id, "bd-x-1");
  assert.equal(ticket.purpose, "取引データを勘定科目へ");
  assert.equal(ticket.ownerCharacterId, "iroha");
  assert.equal(ticket.status, "open");
});

// snapshot は `bd list --all --json`（closed も含む）を叩いて派生する。
// --all を落とすと closed bead が消え、ledger の calls が欠ける（実機で確認済み）。
test("snapshot runs `bd list --all --json` and derives the snapshot", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === "list") {
      return JSON.stringify([
        {
          id: "bd-1",
          title: "T",
          description: "P",
          acceptance_criteria: "A",
          status: "open",
          issue_type: "task",
          metadata: { ownerCharacterId: "iroha" },
          created_at: "2026-06-08T03:14:00Z",
          updated_at: "2026-06-08T03:14:00Z",
        },
      ]);
    }
    return "";
  };

  const pos = createBeadsProjectOs({ exec });
  const snap = pos.snapshot();

  assert.deepEqual(calls[0], ["list", "--all", "--json"]);
  assert.equal(snap.tickets.length, 1);
  assert.equal(snap.tickets[0].id, "bd-1");
  assert.equal(snap.runs.length, 0);
});

// updateTicket: ProjectOs の status 語彙（done/needs_attention）は bd の status
// (open/closed) と別物なので metadata.projectStatus に保持する（--set-metadata で
// 既存 metadata を壊さずマージ）。
test("updateTicket folds ProjectOs status into metadata.projectStatus", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    return "";
  };

  const pos = createBeadsProjectOs({ exec });
  pos.updateTicket("bd-1", { status: "done" });

  assert.equal(calls[0][0], "update");
  assert.ok(calls[0].includes("bd-1"), "targets the bead");
  const joined = calls[0].join(" ");
  assert.ok(
    joined.includes("projectStatus") && joined.includes("done"),
    "folds projectStatus=done into metadata",
  );
});

// createRun: 1委譲=1bead=1run なので run.id = ticketId。run を bead.metadata.run に
// 畳む（--set-metadata でマージ。値は JSON 文字列）。RunRecord を返す。
test("createRun folds a running run into the bead and returns a RunRecord", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    return "";
  };

  const pos = createBeadsProjectOs({ exec });
  const run = pos.createRun({
    ticketId: "bd-1",
    harnessId: "tax-v3",
    input: { text: "経費を仕分けて", permissionCheck: { allowed: true } },
  });

  assert.equal(calls[0][0], "update");
  assert.ok(calls[0].includes("bd-1"));
  const sm = calls[0].indexOf("--set-metadata");
  assert.ok(sm >= 0, "uses --set-metadata");
  const kv = calls[0][sm + 1];
  assert.ok(kv.startsWith("run="), "folds under the run key");
  const folded = JSON.parse(kv.slice("run=".length));
  assert.equal(folded.harnessId, "tax-v3");
  assert.equal(folded.status, "running");
  assert.equal(folded.input.permissionCheck.allowed, true);

  assert.equal(run.id, "bd-1");
  assert.equal(run.ticketId, "bd-1");
  assert.equal(run.harnessId, "tax-v3");
  assert.equal(run.status, "running");
});

// completeRun: 現在の run を読み（show）、status/output を更新して書き戻し、bead を close。
test("completeRun marks the folded run complete and closes the bead", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === "show") {
      // bd show --json returns an array (batchable); mirror that here.
      return JSON.stringify([
        {
          id: "bd-1",
          metadata: {
            ownerCharacterId: "iroha",
            run: JSON.stringify({
              id: "bd-1",
              ticketId: "bd-1",
              harnessId: "tax-v3",
              status: "running",
              input: { permissionCheck: { allowed: true } },
              output: null,
              createdAt: "2026-06-08T03:04:08Z",
              updatedAt: "2026-06-08T03:04:08Z",
            }),
          },
        },
      ]);
    }
    return "";
  };

  const pos = createBeadsProjectOs({ exec });
  const done = pos.completeRun(
    "bd-1",
    { status: "completed", qualityScore: 4.5 },
    "completed",
  );

  const cmds = calls.map((c) => c[0]);
  assert.ok(cmds.includes("show"), "reads current run");
  assert.ok(cmds.includes("update"), "writes updated run");
  assert.ok(cmds.includes("close"), "closes the bead");
  assert.equal(done.status, "completed");
  assert.equal(done.output.qualityScore, 4.5);
});

// ajimi recommendation-8: completeRun on a bead that never had createRun called
// (no metadata.run) used to spread undefined into a broken half-run and close
// the bead silently. It must throw instead, and must NOT write or close.
test("completeRun throws on a bead without a folded run instead of fabricating one", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === "show") {
      // A bead createRun never touched: no metadata.run.
      return JSON.stringify([
        { id: "bd-orphan", metadata: { ownerCharacterId: "iroha" } },
      ]);
    }
    return "";
  };

  const pos = createBeadsProjectOs({ exec });

  assert.throws(
    () => pos.completeRun("bd-orphan", { qualityScore: 5 }, "completed"),
    /no folded run|metadata\.run/i,
  );
  // Fail fast and clean: nothing was written back, nothing was closed.
  const cmds = calls.map((c) => c[0]);
  assert.ok(!cmds.includes("update"), "must not write a fabricated run");
  assert.ok(!cmds.includes("close"), "must not close the bead");
});

test("completeRun throws when the bead has no metadata at all", () => {
  const exec = (args) =>
    args[0] === "show" ? JSON.stringify([{ id: "bd-bare" }]) : "";

  const pos = createBeadsProjectOs({ exec });

  assert.throws(
    () => pos.completeRun("bd-bare", null, "failed"),
    /no folded run|metadata\.run/i,
  );
});

// addArtifact: 既存 artifacts 配列に追記して bead.metadata.artifacts へ書き戻す。
test("addArtifact appends an artifact to the bead metadata", () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === "show") {
      return JSON.stringify([
        { id: "bd-1", metadata: { ownerCharacterId: "iroha" } },
      ]);
    }
    return "";
  };

  const pos = createBeadsProjectOs({ exec });
  const artifact = pos.addArtifact({
    ticketId: "bd-1",
    runId: "bd-1",
    kind: "pr",
    uri: "https://example/pr/1",
    title: "PR #1",
  });

  const upd = calls.find((c) => c[0] === "update");
  assert.ok(upd, "updates the bead");
  const sm = upd.indexOf("--set-metadata");
  const kv = upd[sm + 1];
  assert.ok(kv.startsWith("artifacts="), "folds under the artifacts key");
  const arr = JSON.parse(kv.slice("artifacts=".length));
  assert.equal(arr.length, 1);
  assert.equal(arr[0].uri, "https://example/pr/1");
  assert.equal(artifact.kind, "pr");
});

// 実機の --set-metadata は入れ子を文字列化する。snapshot はそれをパースして復元し、
// projectStatus を ticket.status に優先する。
test("beadsToSnapshot parses string-encoded run/artifacts and honors projectStatus", () => {
  const beads = [
    {
      id: "bd-1",
      title: "T",
      description: "P",
      status: "closed",
      issue_type: "task",
      metadata: {
        ownerCharacterId: "iroha",
        projectStatus: "done",
        run: JSON.stringify({
          id: "bd-1",
          harnessId: "tax-v3",
          status: "completed",
          input: { permissionCheck: { allowed: true } },
          output: { qualityScore: 4.5 },
          createdAt: "2026-06-08T03:04:08Z",
          updatedAt: "2026-06-08T03:05:00Z",
        }),
        artifacts: JSON.stringify([
          {
            id: "a1",
            ticketId: "bd-1",
            runId: "bd-1",
            kind: "pr",
            uri: "https://example/pr/1",
            title: "PR #1",
          },
        ]),
      },
      created_at: "2026-06-08T03:04:08Z",
      updated_at: "2026-06-08T03:05:00Z",
    },
  ];

  const snapshot = beadsToSnapshot(beads);

  assert.equal(snapshot.tickets[0].status, "done"); // projectStatus 優先
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].harnessId, "tax-v3");
  assert.equal(snapshot.runs[0].input.permissionCheck.allowed, true);
  assert.equal(snapshot.runs[0].output.qualityScore, 4.5);
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.artifacts[0].uri, "https://example/pr/1");
});

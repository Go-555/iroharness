# IroHarness — Agent Bank & Hanaita Plans.md

作成日: 2026-06-05
改訂: 2026-06-05 rev.2（mekiki 四天王レビュー反映）

> このファイルは **Agent Bank / Hanaita 構想** の実装計画です。本体の
> `ROADMAP.md`（Milestone 0–5）とは別物。SSOT は [docs/agent-bank.md](./docs/agent-bank.md)。
> 方針: 既存 IroHarness API は **変更せず足すだけ（非破壊）**。TDD 採用。
> DoD はテスト通過 or 検証可能な成果物で記述。
>
> **セキュリティ不変条件（全 Phase 順守）**:
> 1. staging の recipe に owner 権限 / vault ツール / 許可外ツールを渡さない
> 2. security 判定の権威は **フォルダ位置 ＋ ledger/decision**。recipe frontmatter の
>    `status` / `security_review` / `visibility` は advisory（信用しない）
> 3. delegate 系（delegate_goal 含む）は必ず既存 permission policy / work-runner-policy を通す
> 4. 永続化・書込先は scoped workspace 内に限定。host グローバル設定への書込は既定禁止
>
> 各タスク末尾の `(B-n/W-n)` は mekiki レビュー指摘の対応タグ。

---

## Phase 0: 足場確認（調査のみ・コード変更なし）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 0.1 | `createFileProjectOs` / `createProjectOsMarkdown` の API と runs/artifacts の read/write 契約を把握 | runs/artifacts の取得・書込 API シグネチャを 1 枚にまとめた調査メモが `docs/agent-bank-notes.md` に存在 | - | cc:完了 |
| 0.2 | `createScopedWorkRunnerMicroHarness` / `createOpenClawMicroHarness` の task/context envelope と戻り値契約を把握 | 両 adapter の入出力型を整理したメモが `docs/agent-bank-notes.md` に追記される | - | cc:完了 |
| 0.3 | recipe / ledger の物理配置を確定＋ recipe visibility と既存 audience visibility 語彙のマッピング確認 | 配置決定と visibility マッピングが `docs/agent-bank.md` §8/§11 に追記される | 0.1 | cc:WIP |
| 0.4 | `ask_bank(task)->recipe[]` のマッチ方式決定（キーワード / 意味マッチのコスト・精度トレードオフ） | マッチ方式の決定と根拠が `docs/agent-bank-notes.md` に記録される (W-2) | - | cc:完了 |

## Phase 1: Agent Bank の器（read/write・MVP前半）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 1.1 | recipe.md スキーマ定義 ＋ frontmatter parser | 妥当な recipe.md を parse／不正 frontmatter を弾く、かつ **security フィールド（status/security_review/visibility）を信用せず無視/advisory 化する** reconcile テストが通る (B-2) | 0.3 | cc:完了 |
| 1.2 | Bank registry（staging/active/archived の list / read / move） | フォルダ間 move と一覧取得のユニットテストが通る | 1.1 | cc:完了 |
| 1.3 | `_index.md` 自動生成（archived は集計から除外可能に） | registry 状態から `_index.md` を再生成し内容一致、archived 除外オプションのテストが通る | 1.2 | cc:完了 |
| 1.4 | 既存固定 micro-harness を recipe として登録する seed | Codex/OpenClaw adapter が `active/` に recipe 登録され list に出る。**既存の直接 delegation 経路は不変で、Bank は並列の追加経路**であることを保証するテストが通る (非破壊) | 1.2 | cc:完了 |
| 1.5 | staging 許可ツール allowlist の定義 | staging が要求できるツールの allowlist が設定として定義され、読込テストが通る（mint の intersect 元・3.1 が参照） (B-1) | 1.1 | cc:完了 |

## Phase 2: 評価＋昇格ループ（MVP後半）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 2.1 | run 完了時に runs/artifacts から score を ledger へ記録 | ダミー run 1 件で ledger の calls/success/last_used/avg_score が更新される。**specialist は agent-stats 名前空間へ書込不可（Hanaita のみ書込可）**の負テストが通る (W-4) | 1.2, 0.1 | cc:完了 |
| 2.2 | **単一合成昇格ガード**（閾値 AND sandbox-verified AND security_review-passed AND folder権威）＋ decay 判定 | 4 条件すべて満たす時のみ staging→active、N 日未使用で active→archived。合成ガードを通らない昇格経路が存在しないテストが通る (W-5) | 2.1, 5.1, 5.2 | cc:完了 |
| 2.3 | CLI `iroharness bank list` / `bank promote` | コマンドで registry 状態表示・手動昇格ができ、出力スナップショットテストが通る | 2.2 | cc:完了 |

## Phase 5a: 権限ゲート（動的生成より前に固める・安全の核）⚠️

> mekiki B-1/B-2/B-3 を受け、旧 Phase 5 の権限核を **Phase 3/4 より前** に前倒し。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 5.1 | bantou ゲート: staging に owner 権限 / vault ツール / **allowlist 外ツール**を渡さない | staging recipe に owner visibility や許可外ツール付与を試みると拒否される負テストが通る (B-1) | 1.5, 2.1 | cc:完了 |
| 5.2 | security_review フロー（active 昇格前に必須）＋ **動的 mint 由来の初回 active 昇格は owner human-in-loop**（seed 由来は対象外） | security_review 未通過 recipe は active 昇格不可、かつ mint 由来初回昇格が owner 承認なしに通らない負テストが通る (W-3) | 5.1 | cc:完了 |

## Phase 3: 動的生成（mint_specialist）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 3.1 | `mint_specialist`: task から recipe(role/prompt/toolset) を生成＋ **要求 toolset を allowlist と intersect（許可外は剥がす/拒否）** | サンプル task から schema 妥当な recipe.md が `staging/` に生成され、許可外ツール要求が剥がれる/拒否される負テストが通る (B-1) | 3.1依存→ 1.1, 1.5, 5.1 | cc:TODO |
| 3.2 | 生成 recipe の永続化連携 ＝ **書込先を scoped workspace 内に限定**。host グローバル agent dir（`~/.claude/agents/` 等）への書込は owner 明示承認時のみ・既定禁止 | scoped workspace への書込は成功、host グローバルへの書込が既定で拒否される境界テストが通る（mock 可） (B-4) | 3.1, 0.2 | cc:TODO |
| 3.3 | 生成 recipe のサンドボックス検証（Work Runner 隔離試走） | 未検証 recipe は active へ昇格できないことを保証するテストが通る（2.2 合成ガードの sandbox-verified 条件を満たす） | 3.1, 2.2 | cc:TODO |

## Phase 4: Hanaita orchestration（delegate_goal）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 4.1 | `delegate_goal` ツール（async）＝ **既存 permission policy / work-runner-policy を必ず経由** | goal 投入→要約が非同期で返る統合テスト、かつ **public view が delegate_goal を呼ぶと拒否**される負テストが通る (B-3) | 1.2, 5.1 | cc:TODO |
| 4.2 | context slice 配布 ＋ 黒板 post/read（Project OS 経由・双方向隔離） | 職人は黒板の確定成果のみ受け取り生 context を継がない。**逆方向＝orchestration の中間 chatter が Iroha の identity context を汚さない**ことも保証するテストが通る (§6.3) | 4.1, 0.1 | cc:TODO |
| 4.3 | 縦糸采配（star: assign→verify→next）＋ pipeline / fan-out | 2 職人の pipeline と fan-in が 1 goal を完遂するテストが通る | 4.2 | cc:TODO |
| 4.4 | verify ループ（mekiki=質 / bantou=権限 → 差し戻し → 上限打切り） | 不合格成果が差し戻され反復上限で打ち切られるテストが通る | 4.3 | cc:TODO |
| 4.5 | コスト/暴走ガード: `max_specialists_per_goal` / `max_depth`（再帰 delegate）/ `token_budget` を policy 化 | 各上限超過で goal が打ち切られる負テストが通る。minted specialist の再帰 delegate も depth 上限に従う (W-1) | 4.1 | cc:TODO |

## Phase 5b: 隔離の最終硬化

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 5.3 | Work Runner 隔離の徹底（work-runner-policy 連携・全経路） | public view は delegate 不可、trusted は許可制、owner のみ runner-scoped で可、を全 delegate 経路で保証するテストが通る | 5.1, 4.1, 3.3 | cc:TODO |

## §6.2 / §6.3 設計要素のスコープ判断（要・親方確認）

| 項目 | 設計書 | 扱い |
|------|--------|------|
| §6.2 非同期・チャネル跨ぎ復帰（voice 即応→text で結果返却） | agent-bank.md §6.2 | **MVP 外**（Phase 4 完了後の拡張）として明記。必要なら別タスク化 |
| §6.3 orchestration 失敗時の face graceful recovery（「少々お待ちを」） | agent-bank.md §6.3 | **要タスク化候補**。Phase 4 の堅牢化として 4.6 追加を推奨（親方判断） |

---

## 優先度・推奨着手順

- **Required（MVP）**: Phase 0, 1, 2
- **Required（安全の核・動的生成の前提）**: Phase 5a（5.1, 5.2）
- **Recommended**: Phase 3, 4, 5b
- **推奨着手順**: 0 → 1 → 2 → **5a（5.1, 5.2）** → 3 → 4 → 5b（5.3）
  - ※ 2.2 の合成ガードは 5.1/5.2 に依存するため、5a を 2.2 確定前に着手する

## リスク / 四天王（mekiki rev.2 反映後）

- ⚠️⚠️ セキュリティ: B-1（toolset allowlist→1.5/3.1/5.1）、B-2（frontmatter 不信→1.1）、B-3（delegate ゲート→4.1）、B-4（host 書込境界→3.2）で塞ぐ。bantou 監査は実装時に再度
- ⚠️ コスト: 4.5 で mint回数 / 再帰深さ / token予算の上限を policy 化
- ⚠️ パフォーマンス: 0.4 で ask_bank マッチ方式を決定（reuse 優先＝mint 前に必ず Bank 照会）
- 破壊的変更: なし（1.4 で既存 delegation 経路の不変を負テスト保証）

# iroharness × Agent Bank 設計まとめ（現在地スナップショット）

作成: 2026-06-06 / 更新: 2026-06-08 / 状態: **Project OS を beads に据える方針で確定**

> このドキュメントは「いま設計で分かっていること」の棚卸しです。Agent Bank 中心で
> 進めていた設計を、**まさおさんの3要素（マクロ/ミクロ/Project OS）を背骨に据え直し**、
> さらに **Project OS の実体を beads（bd）に据える**方針で組み直したものです。

---

## 0. 大きな転換

| | Before（当初） | After（今） |
|---|---|---|
| 設計の主役 | Agent Bank（動的生成＋囲い込み） | **マクロ/ミクロ/Project OS の3要素**（まさおさんの思想） |
| 倉庫の実装 | DB（SQLite/Postgres）を自前検討 → 一度は「自作 YAML+MD・DB捨てる」へ | **beads（bd）を採用**。土台は Dolt（Git 同期される版管理 SQL DB）。CLI/JSON でローカル正本を扱う |
| Agent Bank の位置 | 中心 | 3要素の**上に乗る拡張**（再利用・貯蔵）。beads の**外**で共存 |

きっかけ:
1. iroharness の設計思想の源である、まさおさんの note 記事「【次世代】今までのハーネス設計の"その先"に必要だった、更なるハーネス設計思想」。
2. 続く記事「【必見】ProjectOS を実現する注目フレームワークの勉強会」で、まさおさん自身が **beads** を ProjectOS に近づくフレームワークとして紹介（2026-06-07）。これを受けて Project OS の自作を取りやめ、beads 採用へ転換。

> ⚠️ **方針撤回の記録**：一時は「Project OS を自作 YAML+MD で実装、DB は当面捨てる（YAGNI）」と確定していた（旧 §3.1〜3.3）。beads 採用に伴いこの自作レイアウトは破棄。「DB 捨てる」も撤回し、beads（Dolt 土台）を呑む。

---

## 1. 背骨：3要素（マクロ / ミクロ / Project OS）

> 本質はエージェントの数を増やすことではない。**責務と状態を分けること。**

| 要素 | 役割 | 方針 |
|---|---|---|
| **マクロハーネス** | 何を・なぜ・いつやるか（要件整理／優先順位／チケット化／監視／再計画） | **借りる**（汎用エージェント基盤を活かす） |
| **ミクロハーネス** | どう作るか（Agent Teams 分業：分解／実装／テスト／レビュー／ドキュメント） | **作る**（差が出る場所） |
| **Project OS** | 会話を状態に変える状態基盤（マクロとミクロを繋ぐ） | **beads を借りる**（自作しない。差別化はスキル層に置く） |

3つの原則:
- 会話中心 → **状態中心**へ
- 人格を増やすより、**責務境界**を切る
- 全部自作するより、**差が出る場所だけ**自作する（→ Project OS は beads に任せる）

---

## 2. いろは＝花板（人格は1つ）

- いろは（macro harness）は **one identity**。花板は別人格ではなく「いろはの仕事モード」
- **入力チャネル（voice/text）と「常連に聞くか（delegate）」は直交**。判断はいろは自身
- 重い依頼は **非同期またぎ**：voice で即応「あとで返す」→ 裏で処理 → text で返す
- 比喩：いろは＝鮨屋の花板、サブエージェント＝カウンターの常連客（各界の専門家）

---

## 3. 倉庫（Project OS）＝ beads（bd）

Project OS の実体は **beads（bd）**＝ AI エージェント向けの依存グラフ型イシュートラッカー兼構造化メモリ（Steve Yegge 作、MIT、v1.x、Dolt 土台）。
**自作はしない。** 既存の `ProjectOs` 契約（抽象インターフェース）の**新バックエンド**として beads を実装する。

### 3.1 既存 `ProjectOs` 契約に beads を差す（アダプタパターン）

iroharness 本体は既に `ProjectOs` インターフェース（6メソッド）に依存しており、本体・HTTP adapter ともこの契約に乗っている。よって **`createBeadsProjectOs()` を同じ契約で実装すれば、本体も adapter も無改修**で beads に差し替えられる。

| `ProjectOs` メソッド | beads（素のコマンド） |
|---|---|
| `createTicket({title, purpose, acceptance, metadata})` | `bd create "<title>" -d "<purpose>" --acceptance "…" --metadata '{…}' -t task` |
| `updateTicket(id, patch)` | `bd update <id> --status / --metadata / --add-label` |
| `createRun({ticketId, harnessId})` | ticket bead に **`--parent` で子 bead を作成**（試行ごとに別 bead ＝ 別 run.id が採番される。1 Ticket に N 個の子 run bead がぶら下がる） |
| `completeRun(runId, output, status)` | その**子 bead を `bd close`** ＋ `--append-notes` に output（`output.qualityScore` 等を notes/metadata に残す） |
| `addArtifact({runId})` | **子 bead（run bead）** に `--metadata` / `related` リンクで紐付け |
| `snapshot()` | `bd list --json` で ticket bead 群と子 bead 群を取得し、子 bead を `runs` 配列に写して `{tickets, runs, artifacts}` に整形 |

- **Ticket = bead**、**Run = ticket bead の子 bead（parent-child リンク）**、**Artifact = run bead の metadata/link**
- **なぜ子 bead か**：契約上 Run は Ticket とは独立した別レコードで一意な `run.id` を持つ。`createRun→completeRun` が `run.id` を発番・参照し、ledger（`src/agent-bank/ledger.js`）が runs を1件ずつ走査して `output.qualityScore` を集計、昇格ガード（`src/agent-bank/promotion.js`）が `minCalls: 3` を要求する。「Run = ticket bead の claim→close」だと **1 Ticket = 1 Run** しか表せず `minCalls:3` に永久到達できず昇格が動かない。試行ごとに別 bead ＝ 別 id を採番し、`bd list --json` で子 bead 群を `runs` 配列に写すことで ledger の calls 集計が成立する。beads を唯一の正本に保つ。
- 実行順は `blocks`（ready キューを駆動）、着手可能タスクは `bd ready`、排他は `--claim`
- **snapshot のコスト**：`snapshot()` はホットパス（毎ターン・委譲時に複数回）で呼ばれるため、毎回の `bd list --json`（子プロセス spawn ＋ Dolt ＋ JSON parse）はレイテンシ直撃（特に voice 経路）。**変更通知 or TTL でメモ化**し、毎ターンの bd 起動を避ける。
- 既存 `createInMemoryProjectOs` / `createFileProjectOs`（JSON）は**残す**（テスト・フォールバック）＝ 完全非破壊

### 3.2 まさお推奨に忠実に「軽く」使う（彫り込まない）

> まさおさん：「粒度は早々にモデルに吸収される。**過度に作り込むな**。最小の理解は **Claude Code の TODO ツールの置き換え**。プロジェクト規模で分割するものではない」

- **Ticket=bead が背骨**。Run は ticket の**子 bead**（§3.1）、Artifact は run bead の上に薄く（metadata / notes / link）。彫り込みは増やさず、子 bead ＋ metadata で最小に留める
- **マクロ（KPI/Story/Spec）は当面 beads に彫り込まない**。必要になったら `label`（例 `layer:spec`）や `metadata` で薄く乗せる
- **issue type は固定 enum**（`bug/feature/task/epic/chore/decision` ＋ message）。カスタム型は作れない → 層分けは **label/metadata** で行う 〔出典: beads 公式 core-concepts / cli-reference（2026-06 時点で確認）〕
- **記憶は beads の外で設計**（まさお推奨：`bd remember` は prime を肥大化させるので使わない）。beads はノート・コメントのコンテキストメモに留める
- **`bd setup claude` の注入を信用しない（不変条件）**：外部 OSS がこちらの hooks/prime に書き込む操作のため、生成物は**取り込み前に差分監査**し、**hooks は手動承認**、**prime は osushi 側（`.beads/prime.md`）で上書き管理**する。これは CLAUDE.md の「外部サービス連携の追加は親方に確認」ラインに乗る。

### 3.3 使わないもの（YAGNI）

- **formula / molecule / `bd pour`**：宣言的ワークフローテンプレ。協調の本命エンジンだが、まさお推奨「swarm 系は無理に使うな、素の claim/依存で代替」に従い**当面使わない**。同じ協調パターンが3回出てから検討。
- **swarm / federation / マージスロット**：高度概念。基本機能で代替できるため不採用。
- **gate（human/timer/github）**：人間確認ライン・PR/CI 待ちに使える有力機能だが、PoC では見送り、必要が見えてから挿す。

---

## 4. 協力して動く（＝ミクロの本体・本命）

役割を持つ専門家エージェントが、beads（黒板）を介して協力して1つの目的を達成する。**当面は formula を使わず、素の beads ループで回す。**

- **ワーカーサイクル**：`bd ready`（着手可能タスク） → `bd update <id> --claim`（排他着手） → 実行 → `bd close <id>`（ノートを残す）→ 次の ready へ
- **3つの仕掛け**（まさお思想を beads に対応づけ）：
  - 切り身 ＝ 各エージェントは isolated context、必要分だけ渡す（claim した bead ＋ 依存先の確定結果のみ）
  - 黒板 ＝ 確定成果を beads に書き戻す（`close` ＋ notes / metadata）。互いの確定結果だけ読む
  - 縦糸 ＝ いろは（Hanaita）が `blocks` 依存と ready キューで次手をトリガー／検証
- **協調の形**：pipeline ／ fan-out・fan-in ／ verify ループ（すべて `blocks` 依存と ready で表現）
- **3層メモリ**：短期（各エージェントの作業・揮発）／長期（beads・永続）／動的（切り身配り）

> ⚠️ 依然ここが本命。ただし「自作オーケストレーションを彫る」のではなく、**beads の素のループ＋いろはの段取り**で薄く実現する方針に変わった。参考実装として **Gas Town**（Yegge の multi-agent workspace manager、beads 土台）を研究する。

---

## 5. Agent Bank（3要素への拡張）

動的生成を「使い捨て」で終わらせず、優秀な専門家を貯めて再利用する輪。**beads の外**で共存する。

```
タスク → [ask_bank] 優秀な常連がいる？
          ├ いる  → 再利用 ───────────┐
          └ いない → [mint] その場で生成  ┤
                                        ↓
                         [協力して動く（§4）= beads ループ]
                                        ↓
                              目的達成・結果を返す
                                        ↓
                  [評価] run（子 bead）の close 履歴から成績
                                        ↓
                  [昇格] 優秀なら active へ＝「囲う」
```

- **recipe** = YAML フロントマター ＋ Markdown（**beads には載せない**。役割定義の正本は別腹）
- **状態** = staging / active / archived のフォルダ権威（昇格＝フォルダ移動）
- **成績（ledger）** = 既に「Project OS runs から派生」実装済み（コミット `330ac8d`）→ beads バックエンドでも **run（ticket の子 bead）の close 履歴から派生**で繋がる。`minCalls:3` の集計が成立するのは Run = 子 bead 方式（§3.1）が前提
- **昇格ガード** = 閾値 AND sandbox検証 AND security_review AND（mint初回は）owner承認
- セキュリティ不変条件：staging に owner権限/vault/allowlist外ツールを渡さない 等
- **bd バイナリの分離（不変条件）**：beads 導入で新規 `bd` バイナリが登場するが、**staging ワーカーには `bd` 書き込み系（create/update/close）を直接叩かせない**。状態の書き込みは**いろは（花板）経由でのみ**行う（§4 の「縦糸＝いろはがトリガー」と整合）。これにより allowlist 外ツールが staging の手に渡らない不変条件を保つ。

> 棲み分け：**beads = 状態の正本**、**Agent Bank = 専門家（役割定義）の正本**。連携点は「formula を使わない現状では、いろはが ask_bank で recipe を選び、claim したワーカーにその役割を着せる」一箇所に絞る。

---

## 6. 組み込み（サンドイッチ構造）

| 層 | 中身 |
|---|---|
| 鞘（自前） | iroharness の micro-harness 抽象（adapter 契約）＋ `ProjectOs` 契約 |
| 中身（借りる） | OpenClaw / Codex / Claude Code（実行）＋ **beads（状態）** |
| 評価（本社） | Agent Bank（成績・昇格は iroharness が握る） |

> ✅ **配線は未設計ではなかった（事実訂正）**：`ProjectOs` は既に抽象インターフェースとして本体・HTTP adapter に配線済み（`createTicket / createRun / completeRun / addArtifact / snapshot`）。beads は `createBeadsProjectOs()` としてこの契約に差すだけ。`createIroHarness` / router / adapter / bin は概ね存在し、残るは beads バックエンドの実装と配線確認。
>
> ⚠️ **「無改修」の範囲（条件付き）**：adapter は snapshot を読む **read-only consumer** ゆえ無改修は確実。一方、書き込み（`createTicket` / `createRun` 等）は本体 `runMicroHarness` のみが行うため、**本体無改修は Run 写像（§8 論点1）の解決後に保証**される。子 bead 方式（§3.1）で確定済みだが、最終保証は PoC 通過まで条件付き。

---

## 7. 実装状況（2026-06-08 時点）

| 部位 | 状態 |
|---|---|
| `ProjectOs` 契約・本体配線 | **実装済み**（`createInMemoryProjectOs` / `createFileProjectOs` ＋ 本体・adapter が契約に依存） |
| Bank コア（recipe/registry/ledger/seed/昇格ガード/mint/persist-guard） | **実装済み・テスト green**（worktree `feat/agent-bank`） |
| **beads バックエンド（`createBeadsProjectOs`）** | **未着手** ← 次の最優先 |
| 協力して動く（素の beads ループでの orchestration） | **未着手**（方針は確定：formula 不使用、素の ready/claim/close） |
| 設計書 `agent-bank.md` | あり（Agent Bank 中心の旧構成・本書に合わせ要更新） |
| git 履歴 | 一部乱れ（commit と実体がズレ・要棚卸し） |

---

## 8. 確定 vs 論点

**確定したこと**
- 背骨は「マクロ/ミクロ/Project OS の3要素」
- **Project OS の実体は beads（bd）**。自作はしない。「DB 捨てる」は撤回し Dolt を呑む
- beads は **既存 `ProjectOs` 契約の新バックエンド** `createBeadsProjectOs()` として実装（adapter は read-only ゆえ無改修確実、本体無改修は Run 写像解決後に保証＝§6）
- **Run の表現は子 bead 方式で確定**（ticket bead の子 bead＝試行ごとに別 id。ledger の `minCalls:3` 集計が成立。詳細は §3.1 / 下記論点1）
- **まさお推奨に忠実に「軽く」使う**：彫り込まない、formula/swarm は当面不使用、記憶は外部設計
- マクロ（KPI/Story/Spec）は当面 beads に載せない（必要時に label/metadata で薄く）
- Agent Bank（recipe）と記憶は beads の外で共存。ledger は run（子 bead）の close 履歴から派生
- いろは＝花板（人格1つ）

**確定した論点**
1. **Run の表現＝子 bead 方式で確定**：1 Ticket に複数 Run（実行試行）を持たせる方式は、**ticket bead の子 bead（parent-child リンク）**で表す（§3.1）。試行ごとに別 bead ＝ 別 `run.id` が採番され、`bd list --json` の子 bead 群を `runs` 配列に写すことで ledger の `minCalls:3` 集計が成立する。beads を唯一の正本に保つ。
   - 残る細部（**PoC で確認**）：子 bead を **dot-ID 階層**（`bd-a1b2.1`）で表すか、**別ハッシュ id ＋ `--parent` リンク**で表すか。dot-ID は **3階層制限**があるため、ticket が既に深い階層にあると子 run が制限に当たる可能性がある。
   - **最終退路**（PoC で上記2手とも破綻した場合のみ）：runs を beads に載せず **Agent Bank 側の別ストア**に退避する。これでも「Run＝独立レコード・複数試行」の契約は満たせる（§5 の ledger は元々 beads 外で派生する設計と整合）。方式（複数 Run を持つ）は確定済みで、退路を採っても揺らがない。

**まだ決まっていない論点**
2. **snapshot の整形**：`bd list --json` → `{tickets, runs, artifacts}` の写像詳細（label/metadata の読み方、子 bead → runs の写し方）
3. **beads 同期運用**：Dolt remote / Git のどちらで正本を同期するか、`bd init` モード（stealth / contributor）の選択。**Dolt remote を使うならホスティング費を評価**する。
4. マクロを「借りる」具体（OpenClaw 等）と、いろはの identity の境界

---

## 9. 次にやること（案）

1. **PoC（最小・ラウンドトリップ）**：`createBeadsProjectOs` を `createTicket` ＋ `snapshot` だけ実装し、**作った ticket が snapshot で同じ形に戻る（ラウンドトリップ）ことを最小テストで確認**する。TicketRecord は `acceptance: string[]` / `ownerCharacterId` / `executorHarnessId` / `status` / `metadata` を持つ（`src/index.d.ts`）。beads の**固定 enum type ＋ label ＋ metadata からこれらを無損失復元できるか**が論点2そのものなので、**論点2（snapshot 写像）の解決を PoC 合格条件に含める**（「green になる」だけでは不十分）。
2. **PoC（手回し）**：`bd init` → ticket を数個作り `bd ready → update --claim → close` を一周し、type+label+metadata の手応えと snapshot 整形を確かめる。あわせて **snapshot レイテンシを実測**（`bd list --json` の spawn＋Dolt＋parse コスト。voice 経路で許容できるか）し、メモ化要否を判断する。子 bead の **dot-ID 3階層制限**（論点1）にも実機で当たる。
3. PoC の手応えで論点2〜3（snapshot 写像 / 同期運用）と論点1の細部（dot-ID vs `--parent` ハッシュ id）を確定
4. `createBeadsProjectOs` 本実装 → 本体配線確認 → Agent Bank ledger との接続
5. `bd setup claude` の prime 注入を osushi 流にカスタム（`.beads/prime.md`）＝ 差別化のスキル層。**ただし生成物は取り込み前に差分監査・hooks は手動承認・prime は osushi 側で上書き管理**（§3.2 の不変条件。外部連携追加ゆえ親方確認ラインに乗る）
6. 設計書 `agent-bank.md` を本書に合わせて更新 → git 履歴の棚卸し

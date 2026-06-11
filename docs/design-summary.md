# iroharness × Agent Bank 設計まとめ（現在地スナップショット）

作成: 2026-06-06 / 更新: 2026-06-08 / 状態: **Project OS を beads に据え、道A（6メソッド契約保持・内部で畳む・本体無改修）で実装済み**

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
>
> ⚠️ **方針撤回の記録（その2）**：一時は「Run ＝ ticket bead の子 bead（parent-child）」で確定していた（A 案）。これは「1 Ticket に複数 Run を持てないと ledger の `minCalls:3` に到達せず昇格が動かない」という懸念に基づくものだった。**だがこれは事実誤認だった**：`computeLedger`（`src/agent-bank/ledger.js`）は runs を **`harnessId`（専門家）単位**で集計しており、ticket 単位ではない。よって 1 ticket = 1 run のままでも「同じ専門家が3つの別タスクで呼ばれた」で `minCalls:3` に到達する。子 bead は最初から不要だった。**子 bead 方式は撤回し、run を ticket bead に畳む方式に全面移行する。**
>
> ⚠️ **方針補正の記録（その3）**：設計段階では「`ProjectOs` 契約の口を beads ネイティブに**簡素化**し、本体 `runMicroHarness` の書き込み部を**作り直す**」（道B）で進める想定だった。**だが実装は道A を採った**：既存 `ProjectOs` の **6メソッド契約（createTicket / updateTicket / createRun / completeRun / addArtifact / snapshot）をそのまま保ち**、その**内部で beads に畳んだ**。本体 `runMicroHarness` は**一切無改修**で既存テストは全 green。理由は、`design-principles.md §4` と `architecture.md` が示す通り Project OS は **work board** であり、**ticket / run / artifact は独立概念**（ゾーン別可視性 public/trusted/owner もそれぞれ独立にかかる将来要件）だから。6メソッドはこの中核思想に根ざした意図ある設計で、契約を簡素化すると run/artifact の独立概念とゾーン可視性を壊す。よって契約を保ち、内部で畳む道A が正しい。

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
**自作はしない。** `ProjectOs` 契約（抽象インターフェース）の**新バックエンド**として beads を実装する。**道A を採用**＝既存 `ProjectOs` の **6メソッド契約をそのまま保ち**、その**内部で beads に畳む**。本体 `runMicroHarness` は**無改修**、`snapshot()` の戻り形も ledger 互換で温存するため下流も無改修（§3.1）。

### 3.1 6メソッド契約を保ち、内部で「1委譲 = 1 bead」に畳む（道A・アダプタパターン）

beads の流儀は「1委譲 = 1 bead」。run を独立レコードとして別 bead に切らず、**ticket（bead）の metadata に畳む**。ただし**契約の口は既存 `ProjectOs` の6メソッド（createTicket / updateTicket / createRun / completeRun / addArtifact / snapshot）をそのまま保持**し、その**内部実装で beads に畳む**（道A）。`snapshot()` の戻り形 `{tickets, runs, artifacts}` は ledger 互換で**温存**するため、下流（ledger / promotion / HTTP adapter）も本体 `runMicroHarness` も無改修で済む。実装は `src/beads-project-os.js`（`createBeadsProjectOs` / `beadsToSnapshot`）。

| `ProjectOs` メソッド | 内部の beads 操作（実装どおり） |
|---|---|
| `createTicket` | `bd create "<title>" -d "<purpose>" -t task --json`（acceptance があれば `--acceptance`）。owner/executor＋追加 metadata を `--metadata '<JSON>'` に畳む。返った bead JSON を `beadsToSnapshot([bead]).tickets[0]` で TicketRecord に写す |
| `updateTicket` | ProjectOs status（open/done/needs_attention）は bd status（open/closed）と**別語彙**なので、`bd update <id> --set-metadata projectStatus=<status>` に畳む（`--set-metadata` は既存 metadata をマージするので owner/executor/run は壊れない） |
| `createRun` | **1委譲=1bead=1run なので `run.id = ticket(bead).id`**。`run`（status:`"running"`）を `bd update <id> --set-metadata run=<JSON>` で畳む。RunRecord を返す |
| `completeRun` | `bd show <id> --json`（**配列が返る → `[0]`**）で現 run を読み、status/output/updatedAt を更新、`bd update <id> --set-metadata run=<JSON>` で書き戻し ＋ `bd close <id>` |
| `addArtifact` | `bd show <id> --json` → 既存 `artifacts` 配列に追記 → `bd update <id> --set-metadata artifacts=<JSON>`（read-modify-write） |
| `snapshot` | **`bd list --all --json`**（closed 含む）を取得し、`beadsToSnapshot` で `{tickets, runs, artifacts}` に**派生再構成**（ledger 互換形を維持。各 bead の metadata から `runs[]` の `harnessId` / `status` / `output.qualityScore` / `updatedAt` / **`input`** を写し出す） |

- **Ticket = bead**、**Run = ticket bead の metadata に畳む（独立レコードにしない・`run.id = bead.id`）**、**Artifact = 同じ bead の metadata 配列**
- **`beadsToSnapshot`（純関数）の写し方**：ticket.status は `metadata.projectStatus ?? bd status`（projectStatus 優先）。run / artifacts は **文字列化されていれば `JSON.parse`**（実機の `--set-metadata` は入れ子 JSON を文字列保存するため。既にパース済みオブジェクトも許容）。run を畳んでいない bead からは run を出さない。
- **なぜ run を ticket に畳めるか**：ledger（`src/agent-bank/ledger.js` の `computeLedger`）は runs を **`harnessId`（専門家）単位**で集計する（`for (const run of runs) { id = run.harnessId; entry.calls++ }`）。集計単位は ticket ではなく専門家。よって `minCalls:3`（昇格ガード `src/agent-bank/promotion.js`）は「**同じ専門家(harnessId)が3つの別タスクで呼ばれた**」で満たされ、**1 ticket = 1 run のままで到達する**。実際 本体 `runMicroHarness`（`src/index.js` 2881-3001）は **1委譲 = 1 ticket = 1 run**（試行ループ無し）で動いており、子 bead は最初から不要だった。snapshot で全 bead を「1 bead = 1 run」として派生すれば、ledger の calls 集計はそのまま成立する。beads を唯一の正本に保つ。
- **★ `run.input` は確定要件**（論点ではない）：ledger は `input` を読まないが、**既存テスト `harness.test.js` が `snapshot.runs[0].input.permissionCheck.allowed` を検証している**（`run.input` は本体 `runMicroHarness` で `{...input, permissionCheck}` が入る）。既存テスト green 維持のため、`input` は metadata に畳んで snapshot で必ず復元する（実装済み）。
- 実行順は `blocks`（ready キューを駆動）、着手可能タスクは `bd ready`、排他は `--claim`
- **snapshot のコスト**：`snapshot()` はホットパス（毎ターン・委譲時に複数回）で呼ばれるため、毎回の `bd list --all --json`（子プロセス spawn ＋ Dolt ＋ JSON parse）はレイテンシ直撃（特に voice 経路）。**変更通知 or TTL でメモ化**し、毎ターンの bd 起動を避ける（レイテンシ実測の上で判断＝§9）。
- **契約は保持**：6メソッド契約はそのまま。道A では `src/index.d.ts` の型定義も `createInMemoryProjectOs` / `createFileProjectOs` 実装も触らずに済む（契約を簡素化しないため）。
- 既存 `createInMemoryProjectOs` / `createFileProjectOs`（JSON）は**残す**（テスト・フォールバック）＝ 完全非破壊
- **将来の拡張余地（今は YAGNI）**：retry/verify ループで「1 ticket に複数 run」が要るようになって初めて、その時に子 bead 等で拡張する。現状（1委譲1run）では不要。

> ⚠️ **既知制約（beads バックエンドと in-memory/file 実装の契約ドリフト。mekiki W-C）**
> beads バックエンド（`src/beads-project-os.js`）は 6 メソッドの「口」は保つが、以下 3 点で in-memory/file 実装と挙動が異なる。**コードは直していない（文書化のみ）**——直すのは将来の beads 実配線時。下流（ledger / promotion / 本体 `runMicroHarness`）はいずれにも依存していないため現状実害なし。
>
> 1. **`updateTicket` は `patch.status` 以外を黙って捨てる**。in-memory 実装は patch 全体をマージし、更新後の ticket を返し、不在 id には throw する。beads 版は `projectStatus` への畳み込みだけを行い、**戻り値なし・不在チェックなし**（存在しない id でも黙って `bd update` が走るだけ）。
> 2. **`snapshot()` の ticket に `metadata` フィールドがない**。`createTicket` で渡した追加 metadata は bead には畳まれるが、`beadsToSnapshot` は ticket への写し出しで `metadata` を復元しない（owner/executor 等の既知フィールドのみ写す）。in-memory 実装の ticket は `metadata` を保持する。
> 3. **`acceptance` 配列は非可逆**。`createTicket` で `--acceptance` に `join("\n")` で畳み、snapshot では `[bead.acceptance_criteria]` の **1 要素配列**として返る。複数要素の acceptance は往復で形が変わる（要素境界が失われる）。

> まさおさん：「粒度は早々にモデルに吸収される。**過度に作り込むな**。最小の理解は **Claude Code の TODO ツールの置き換え**。プロジェクト規模で分割するものではない」

- **Ticket=bead が背骨**。Run は ticket bead に**畳む（独立レコードにしない）**（§3.1）、Artifact は同じ bead の上に薄く（metadata / notes / link）。彫り込みは増やさず、bead ＋ metadata で最小に留める
- **マクロ（KPI/Story/Spec）は当面 beads に彫り込まない**。必要になったら `label`（例 `layer:spec`）や `metadata` で薄く乗せる
- **issue type は固定 enum**（`bug/feature/task/epic/chore/decision` ＋ message）。カスタム型は作れない → 層分けは **label/metadata** で行う。metadata は JSON で無損失格納できる 〔出典: beads 公式 core-concepts / cli-reference（2026-06 時点で確認）〕
- **実機で判明した bd の挙動**（実装が依存している確定事実。§3.1 の表に反映済み）：
  - `bd show --json` は**配列**を返す（複数 id をバッチ可能）→ 単一取得でも `[0]` を取る
  - `bd update --set-metadata key=value` は既存 metadata を**マージ**するが、**入れ子 JSON 値は文字列としてエスケープ保存**される → snapshot 側（`beadsToSnapshot`）で `JSON.parse` して復元する
  - `bd list` はデフォルト **open のみ**。closed を含めるには **`--all`** が必要（snapshot で必須＝落とすと closed bead の run が ledger calls から欠ける）
  - `bd init` は **embedded dolt**（`Backend: dolt / Mode: embedded`）＝ bd バイナリ単体で完結し、外付け dolt は不要
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
                  [評価] bead（=ticket）の close 時記録から harnessId 単位で成績
                                        ↓
                  [昇格] 優秀なら active へ＝「囲う」
```

- **recipe** = YAML フロントマター ＋ Markdown（**beads には載せない**。役割定義の正本は別腹）
- **状態** = staging / active / archived のフォルダ権威（昇格＝フォルダ移動）
- **成績（ledger）** = 既に「Project OS runs から派生」実装済み（コミット `330ac8d`）→ beads バックエンドでも **bead（=ticket）の close 時記録から派生**で繋がる（実装・実機統合テストで確認済み）。`computeLedger` は **全 bead を harnessId 単位で集計**するため、`minCalls:3` は「専門家が3つの別タスクで呼ばれれば成立」する（1 ticket = 1 run で足りる。§3.1）
- **昇格ガード** = 閾値 AND sandbox検証 AND security_review AND（mint初回は）owner承認
- セキュリティ不変条件：staging に owner権限/vault/allowlist外ツールを渡さない 等
- **bd バイナリの分離（不変条件）**：beads 導入で新規 `bd` バイナリが登場するが、**staging ワーカーには `bd` 書き込み系（create/update/close）を直接叩かせない**。状態の書き込みは**いろは（花板）経由でのみ**行う（§4 の「縦糸＝いろはがトリガー」と整合）。これにより allowlist 外ツールが staging の手に渡らない不変条件を保つ。

> 棲み分け：**beads = 状態の正本**、**Agent Bank = 専門家（役割定義）の正本**。連携点は「formula を使わない現状では、いろはが ask_bank で recipe を選び、claim したワーカーにその役割を着せる」一箇所に絞る。

---

## 6. 組み込み（サンドイッチ構造）

| 層 | 中身 |
|---|---|
| 鞘（自前） | iroharness の micro-harness 抽象（adapter 契約）＋ `ProjectOs` 6メソッド契約 |
| 中身（借りる） | OpenClaw / Codex / Claude Code（実行）＋ **beads（状態）** |
| 評価（本社） | Agent Bank（成績・昇格は iroharness が握る） |

> ✅ **配線は既存のまま**：`ProjectOs` は既に抽象インターフェースとして本体・HTTP adapter に配線済み。beads は `createBeadsProjectOs()` としてこの6メソッドの口にそのまま差す。`createIroHarness` / router / adapter / bin は既存のまま流用でき、追加したのは beads バックエンド実装（`src/beads-project-os.js`）のみ。
>
> ✅ **本体無改修は道A で確実に成立**：契約（6メソッド）も `snapshot()` の戻り形 `{tickets, runs, artifacts}` も保持したため、**本体 `runMicroHarness` は無改修**、かつ **HTTP adapter / ledger（`computeLedger`）/ promotion も無改修**（いずれも snapshot を読む read-only consumer、または snapshot 派生の runs を harnessId 単位で集計するだけ）。beads への畳み込みは6メソッドの**内部実装に閉じている**。既存テストは全 green（§7）。

---

## 7. 実装状況（2026-06-10 時点）

| 部位 | 状態 |
|---|---|
| `ProjectOs` 契約・本体配線 | **実装済み**（`createInMemoryProjectOs` / `createFileProjectOs` ＋ 本体・adapter が契約に依存） |
| Bank コア（recipe/registry/ledger/seed/昇格ガード） | **実装済み・テスト green** |
| **Phase 3 動的生成（mint / persist-guard / sandbox 検証）** | **実装済み・テスト green・本トランシェ収録**。mint は id 検証＋frontmatter 注入拒否＋allowlist intersect＋staging ガード必須経由、persist は scoped workspace 限定（host グローバル dir は既定拒否・owner 承認のみ）、sandbox 検証は bank root の `verification-ledger.json` が権威（昇格ガードは記録優先で導出、`runTrial` への実 Work Runner 配線は今後） |
| **beads バックエンド（`createBeadsProjectOs`・道A／6メソッド保持）** | **実装済み**（`src/beads-project-os.js`）。ユニット（fake exec）11 green ＋ **実 bd 統合テスト 1 green**、全体 204 green |
| **本体 `runMicroHarness`** | **無改修**（道A＝6メソッド契約と snapshot 互換を保持したため。既存テスト全 green） |
| snapshot メモ化（レイテンシ実測の上で） | **未了**（要否を実測で判断＝§9） |
| 協力して動く（Hanaita orchestration / `delegate_goal`・Phase 4） | **実装済み・テスト green**（`src/agent-bank/hanaita.js`＋`blackboard.js`。切り身配布・黒板＝ProjectOs 6メソッド経由（in-memory / beads 同一契約をテストで保証）・star/pipeline/fan-out・verify ループ・コストガード W-1。職人実行は `createRunner` 注入式で **実 micro-harness への配線は未了**。formula 不使用の方針どおり） |
| 設計書 `agent-bank.md` | あり（2026-06-10 改訂済み：beads 整合＋Phase 3 実装状況を反映） |
| git 履歴 | 一部乱れ（commit と実体がズレ・要棚卸し） |

---

## 8. 確定 vs 論点

**確定したこと**
- 背骨は「マクロ/ミクロ/Project OS の3要素」
- **Project OS の実体は beads（bd）**。自作はしない。「DB 捨てる」は撤回し Dolt を呑む
- **道A を採用**＝beads は **既存 `ProjectOs` 6メソッド契約を保ったままの新バックエンド**（`createBeadsProjectOs()`）として実装し、内部で beads に畳む。snapshot を ledger 互換形で温存したため **本体 `runMicroHarness` / HTTP adapter / ledger / promotion は全て無改修**（§6）。道B（契約簡素化・本体書き込み部の作り直し）は不採用
- **Run は ticket(bead) の metadata に畳む（`run.id = bead.id`）。子 bead は不要**（ledger は harnessId 単位集計のため 1 ticket = 1 run で `minCalls:3` に到達。詳細は §3.1）
- **実機 bd の挙動は確定事項**：`bd show --json` は配列を返す（`[0]`）／`--set-metadata` は既存 metadata をマージしつつ入れ子 JSON を文字列保存（snapshot 側で `JSON.parse`）／`bd list` は closed を含めるため `--all` 必須／`bd init` は embedded dolt（外付け不要）。詳細は §3.2
- **snapshot 写像は確定・実装済み**：`bd list --all --json` → `beadsToSnapshot` で `{tickets, runs, artifacts}` を派生。ticket.status は `metadata.projectStatus ?? bd status`、run/artifacts は文字列なら parse。TicketRecord の無損失復元と ledger 互換（harnessId 単位 calls/success/avgScore 一致）は実 bd 統合テストで確認済み
- **まさお推奨に忠実に「軽く」使う**：彫り込まない、formula/swarm は当面不使用、記憶は外部設計
- マクロ（KPI/Story/Spec）は当面 beads に載せない（必要時に label/metadata で薄く）
- Agent Bank（recipe）と記憶は beads の外で共存。ledger は bead（=ticket）の close 時記録から harnessId 単位で派生
- いろは＝花板（人格1つ）
- 〔脚注／事実誤認の記録〕一時は「Run＝子 bead 方式で確定」としていたが、これは「ledger が ticket 単位で集計する」という**誤認**に基づくものだった。実コードでは `computeLedger` が **harnessId 単位**で集計するため、子 bead は不要。経緯は §0「方針撤回の記録（その2）」参照。

**まだ決まっていない論点**
1. **snapshot メモ化**：`bd list --all --json`（spawn＋Dolt＋parse）のレイテンシを実測し、変更通知 or TTL メモ化の要否を決める（写像自体は確定・実装済み。残るは性能最適化のみ）。
2. **beads 同期運用**：Dolt remote / Git のどちらで正本を同期するか、`bd init` モード（stealth / contributor）の選択。**Dolt remote を使うならホスティング費を評価**する。
3. **マクロ借り物の境界**：マクロを「借りる」具体（OpenClaw 等）と、いろはの identity の境界。

---

## 9. 次にやること

**済んだこと（道A）**

- ✅ **`createBeadsProjectOs` 実装済み**（道A・6メソッド保持）：createTicket / updateTicket / createRun（`run.id=bead.id`・metadata に畳む）/ completeRun（show→更新→write-back→close）/ addArtifact / snapshot（`bd list --all --json` → 派生）。`input` は metadata に畳んで snapshot で復元（§3.1 ★）。実装 `src/beads-project-os.js`
- ✅ **snapshot ラウンドトリップ ＋ ledger 互換**：beads 経由のタスク群から `computeLedger` の harnessId 単位 calls / success / avgScore が一致することを検証（ユニット・統合テスト green）
- ✅ **実 bd 統合テスト green**：create → run → complete → artifact → snapshot のフルラウンドトリップを実バイナリで通過（`test/beads-project-os.integration.test.js`）
- ✅ **本体無改修で既存テスト全 green**：道A ゆえ `runMicroHarness` / adapter / ledger / promotion は無改修。全体 204 green

**残り（未了）**

1. **snapshot レイテンシ実測 ＆ メモ化判断**：`bd list --all --json` の spawn＋Dolt＋parse コストを実測（voice 経路で許容できるか）し、変更通知 or TTL メモ化の要否を決める。
2. `bd setup claude` の prime 注入を osushi 流にカスタム（`.beads/prime.md`）＝ 差別化のスキル層。**ただし生成物は取り込み前に差分監査・hooks は手動承認・prime は osushi 側で上書き管理**（§3.2 の不変条件。外部連携追加ゆえ親方確認ラインに乗る）
3. **beads 同期運用（Dolt remote / Git）**の決定（§8 論点2。Dolt remote ならホスティング費を評価）
4. 設計書 `agent-bank.md` を本書に合わせて更新 → git 履歴の棚卸し

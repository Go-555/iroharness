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
>
> ⚠️ **方針撤回の記録（その2）**：一時は「Run ＝ ticket bead の子 bead（parent-child）」で確定していた（A 案）。これは「1 Ticket に複数 Run を持てないと ledger の `minCalls:3` に到達せず昇格が動かない」という懸念に基づくものだった。**だがこれは事実誤認だった**：`computeLedger`（`src/agent-bank/ledger.js`）は runs を **`harnessId`（専門家）単位**で集計しており、ticket 単位ではない。よって 1 ticket = 1 run のままでも「同じ専門家が3つの別タスクで呼ばれた」で `minCalls:3` に到達する。子 bead は最初から不要だった。**子 bead 方式は撤回し、B 案（run を ticket bead に畳む）に全面移行する。**

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
**自作はしない。** `ProjectOs` 契約（抽象インターフェース）の**新バックエンド**として beads を実装する。なお契約の口は beads ネイティブに簡素化するが、`snapshot()` の戻り形は ledger 互換で温存して下流を無改修に保つ（§3.1）。

### 3.1 beads ネイティブに「1委譲 = 1 bead」で畳む（アダプタパターン）

beads の流儀は「1委譲 = 1 bead」。run を独立レコードとして別 bead に切らず、**ticket（bead）に畳む**。`bd close` 時に bead の metadata/notes へ実行結果 `{harnessId, status, output(qualityScore), artifacts}` を記録する。
本体は `ProjectOs` 契約に乗っているが、その契約自体を **beads ネイティブな簡素な口**に見直す（§3.1 末尾）。ただし `snapshot()` の戻り形 `{tickets, runs, artifacts}` は ledger 互換で**温存**するため、下流（ledger / promotion / HTTP adapter）は無改修で済む。

| `ProjectOs` の操作 | beads（素のコマンド） |
|---|---|
| タスク作成（旧 `createTicket`） | `bd create "<title>" -d "<purpose>" --acceptance "…" --metadata '{…}' -t task` |
| 状態遷移（旧 `updateTicket`） | `bd update <id> --status / --metadata / --add-label` |
| 結果記録（旧 `createRun`＋`completeRun`＋`addArtifact` を統合） | **`bd close <id>` 時に bead の metadata へ `{harnessId, status, output, artifacts, input}` を畳む**（run は独立レコードにしない。`--append-notes` で `output.qualityScore` 等を notes/metadata に残し、artifacts も同じ bead の metadata/link に紐付ける。**`input`（TurnInput＋permissionCheck）も畳む**＝下記★） |
| `snapshot()` | `bd list --json` を取得し、**1 bead = 1 run** として `{tickets, runs, artifacts}` に**派生再構成**（ledger 互換形を維持。各 bead の metadata から `runs[]` の `harnessId` / `status` / `output.qualityScore` / `updatedAt` / **`input`** を写し出す） |

- **Ticket = bead**、**Run = ticket bead に畳む（独立レコードにしない）**、**Artifact = 同じ bead の metadata/link**
- **なぜ run を ticket に畳めるか**：ledger（`src/agent-bank/ledger.js` の `computeLedger`）は runs を **`harnessId`（専門家）単位**で集計する（`for (const run of runs) { id = run.harnessId; entry.calls++ }`）。集計単位は ticket ではなく専門家。よって `minCalls:3`（昇格ガード `src/agent-bank/promotion.js`）は「**同じ専門家(harnessId)が3つの別タスクで呼ばれた**」で満たされ、**1 ticket = 1 run のままで到達する**。実際 本体 `runMicroHarness`（`src/index.js` 2881-3001）は **1委譲 = 1 ticket = 1 run**（試行ループ無し）で動いており、子 bead は最初から不要だった。snapshot で全 bead を「1 bead = 1 run」として派生すれば、ledger の calls 集計はそのまま成立する。beads を唯一の正本に保つ。
- **★ `run.input` は確定要件**（論点ではない）：ledger は `input` を読まないが、**既存テスト `harness.test.js` が `snapshot.runs[0].input.permissionCheck.allowed` を検証している**（`run.input` は本体 `runMicroHarness` で `{...input, permissionCheck}` が入る）。§9-3「既存テスト green 維持」を満たすため、`input` は metadata に畳んで snapshot で必ず復元する。
- 実行順は `blocks`（ready キューを駆動）、着手可能タスクは `bd ready`、排他は `--claim`
- **snapshot のコスト**：`snapshot()` はホットパス（毎ターン・委譲時に複数回）で呼ばれるため、毎回の `bd list --json`（子プロセス spawn ＋ Dolt ＋ JSON parse）はレイテンシ直撃（特に voice 経路）。B 案でも `bd list --json` は毎ターン走るため、**変更通知 or TTL でメモ化**し、毎ターンの bd 起動を避ける。
- **契約の見直し**：旧「6メソッド固定契約」は beads ネイティブな簡素な口に見直す。最低限＝ タスク作成 / 結果記録（旧 createRun+completeRun+addArtifact を畳む）/ 状態遷移 / snapshot（派生）。ただし `snapshot()` の戻り形は ledger 互換を維持する。
- 既存 `createInMemoryProjectOs` / `createFileProjectOs`（JSON）は**残す**（テスト・フォールバック）＝ 完全非破壊
- **将来の拡張余地（今は YAGNI）**：retry/verify ループで「1 ticket に複数 run」が要るようになって初めて、その時に子 bead 等で拡張する。現状（1委譲1run）では不要。

### 3.2 まさお推奨に忠実に「軽く」使う（彫り込まない）

> まさおさん：「粒度は早々にモデルに吸収される。**過度に作り込むな**。最小の理解は **Claude Code の TODO ツールの置き換え**。プロジェクト規模で分割するものではない」

- **Ticket=bead が背骨**。Run は ticket bead に**畳む（独立レコードにしない）**（§3.1）、Artifact は同じ bead の上に薄く（metadata / notes / link）。彫り込みは増やさず、bead ＋ metadata で最小に留める
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
                  [評価] bead（=ticket）の close 時記録から harnessId 単位で成績
                                        ↓
                  [昇格] 優秀なら active へ＝「囲う」
```

- **recipe** = YAML フロントマター ＋ Markdown（**beads には載せない**。役割定義の正本は別腹）
- **状態** = staging / active / archived のフォルダ権威（昇格＝フォルダ移動）
- **成績（ledger）** = 既に「Project OS runs から派生」実装済み（コミット `330ac8d`）→ beads バックエンドでも **bead（=ticket）の close 時記録から派生**で繋がる。`computeLedger` は **全 bead を harnessId 単位で集計**するため、`minCalls:3` は「専門家が3つの別タスクで呼ばれれば成立」する（1 ticket = 1 run で足りる。§3.1）
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

> ✅ **配線は未設計ではなかった（事実訂正）**：`ProjectOs` は既に抽象インターフェースとして本体・HTTP adapter に配線済み。beads は `createBeadsProjectOs()`（または見直した簡素契約）としてこの口に差す。`createIroHarness` / router / adapter / bin は概ね存在し、残るは beads バックエンドの実装と本体書き込み部の差し替え。
>
> ⚠️ **「無改修」の範囲（正確化）**：snapshot の戻り形 `{tickets, runs, artifacts}` を ledger 互換で温存するため、**HTTP adapter / ledger（`computeLedger`）/ promotion は無改修**（いずれも snapshot を読む read-only consumer、または snapshot 派生の runs を harnessId 単位で集計するだけ）。**一方、本体 `runMicroHarness` の書き込み部は B 案で作り直す**：現状の createTicket / createRun / completeRun / addArtifact / updateTicket の6呼び出しを、beads ネイティブな少数呼び出し（タスク作成＋結果記録＝close 時 metadata 畳み込み＋状態遷移）に置き換える。**「本体無改修」とは言わない**（書き込み部は変わる。snapshot 互換ゆえ下流のみ無改修）。

---

## 7. 実装状況（2026-06-08 時点）

| 部位 | 状態 |
|---|---|
| `ProjectOs` 契約・本体配線 | **実装済み**（`createInMemoryProjectOs` / `createFileProjectOs` ＋ 本体・adapter が契約に依存） |
| Bank コア（recipe/registry/ledger/seed/昇格ガード/mint/persist-guard） | **実装済み・テスト green**（worktree `feat/agent-bank`） |
| **beads バックエンド（`createBeadsProjectOs`／見直した簡素契約）** | **未着手** ← 次の最優先 |
| **本体 `runMicroHarness` 書き込み部の作り直し** | **未着手**（現6呼び出し → beads ネイティブな結果記録に。snapshot 互換は保つ＝下流無改修） |
| 協力して動く（素の beads ループでの orchestration） | **未着手**（方針は確定：formula 不使用、素の ready/claim/close） |
| 設計書 `agent-bank.md` | あり（Agent Bank 中心の旧構成・本書に合わせ要更新） |
| git 履歴 | 一部乱れ（commit と実体がズレ・要棚卸し） |

---

## 8. 確定 vs 論点

**確定したこと**
- 背骨は「マクロ/ミクロ/Project OS の3要素」
- **Project OS の実体は beads（bd）**。自作はしない。「DB 捨てる」は撤回し Dolt を呑む
- beads は **`ProjectOs` 契約の新バックエンド**（`createBeadsProjectOs()`／beads ネイティブな簡素契約）として実装。snapshot を ledger 互換形で温存するため **HTTP adapter / ledger / promotion は無改修**。一方 **本体 `runMicroHarness` の書き込み部は作り直す**（§6）
- **Run は ticket(bead) に畳む。子 bead は不要**（ledger は harnessId 単位集計のため 1 ticket = 1 run で `minCalls:3` に到達。詳細は §3.1）
- **まさお推奨に忠実に「軽く」使う**：彫り込まない、formula/swarm は当面不使用、記憶は外部設計
- マクロ（KPI/Story/Spec）は当面 beads に載せない（必要時に label/metadata で薄く）
- Agent Bank（recipe）と記憶は beads の外で共存。ledger は bead（=ticket）の close 時記録から harnessId 単位で派生
- いろは＝花板（人格1つ）
- 〔脚注／事実誤認の記録〕一時は「Run＝子 bead 方式で確定」としていたが、これは「ledger が ticket 単位で集計する」という**誤認**に基づくものだった。実コードでは `computeLedger` が **harnessId 単位**で集計するため、子 bead は不要。経緯は §0「方針撤回の記録（その2）」参照。

**まだ決まっていない論点**
1. **snapshot 写像**：`bd list --json` → `{tickets, runs, artifacts}` の派生詳細。特に **runs の `harnessId` / `output.qualityScore` / `status` / `updatedAt` を bead の metadata/notes にどう格納し、どう読み出すか**（label/metadata の読み方、1 bead → 1 run の写し方）。TicketRecord の無損失復元（§9）と表裏。
2. **beads 同期運用**：Dolt remote / Git のどちらで正本を同期するか、`bd init` モード（stealth / contributor）の選択。**Dolt remote を使うならホスティング費を評価**する。
3. **マクロ借り物の境界**：マクロを「借りる」具体（OpenClaw 等）と、いろはの identity の境界。

---

## 9. 次にやること（B 案の実装手順）

1. **`createBeadsProjectOs`（または見直した簡素契約）を実装**：タスク作成 ＋ 結果記録（`bd close` 時に bead の metadata へ `{harnessId, status, output, artifacts, input}` を畳む。`input` は既存テストが読むため必須＝§3.1 ★）＋ snapshot 派生（`bd list --json` → 1 bead = 1 run で `{tickets, runs, artifacts}` に再構成）。TicketRecord は `acceptance: string[]` / `ownerCharacterId` / `executorHarnessId` / `status` / `metadata` を持つ（`src/index.d.ts`）。beads の **固定 enum type ＋ label ＋ metadata からこれらを無損失復元できるか**が論点1そのもの。
2. **snapshot ラウンドトリップ ＋ ledger 互換テスト**：beads 経由で作ったタスク群（同じ harnessId が3タスク等）から `computeLedger` が**既存（InMemory/File バックエンド）と同じ結果を出すか**＝ harnessId 単位の calls / success / avgScore が一致するかを**合格条件**にする（「green になる」だけでは不十分。harnessId 集計が合うことが要件）。
3. **本体 `runMicroHarness` 書き込み部を新契約に差し替え**：現6呼び出し（createTicket/createRun/completeRun/addArtifact/updateTicket）を beads ネイティブな結果記録に置換し、**既存テスト（project-os / ledger / harness）の green を維持**する。snapshot 互換ゆえ下流（adapter/ledger/promotion）は触らない。**契約の口（`ProjectOs`）を簡素化する場合は `src/index.d.ts` の型定義と `createInMemoryProjectOs` / `createFileProjectOs` 実装も同時に追従**させる（型と既存2実装の整合を崩さない）。
4. **snapshot レイテンシ実測 ＆ メモ化判断**：`bd list --json` の spawn＋Dolt＋parse コストを実測（voice 経路で許容できるか）し、変更通知 or TTL メモ化の要否を決める。
5. `bd setup claude` の prime 注入を osushi 流にカスタム（`.beads/prime.md`）＝ 差別化のスキル層。**ただし生成物は取り込み前に差分監査・hooks は手動承認・prime は osushi 側で上書き管理**（§3.2 の不変条件。外部連携追加ゆえ親方確認ラインに乗る）
6. 設計書 `agent-bank.md` を本書に合わせて更新 → git 履歴の棚卸し

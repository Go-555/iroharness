# StackChan Streaming Voice Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AIAvatarKit と同等のストリーミング会話（文分割逐次 TTS・Silero VAD・streaming brain）を Node の IroHarness に実装し、StackChan の first audio を返答全長から「最初の1文分」に短縮する。

**Architecture:** `src/voice-pipeline/` に単体テスト可能な小部品（splitter / pacer / resampler / metrics / quick-responder / silero-vad）を新設し、`pipeline.js` が束ねる。brain には任意メソッド `respondStream`、harness には `receiveStream` を**追加のみ**（既存 API 非破壊）。人格・権限は毎ターン harness 関所を通す。

**Tech Stack:** Node 20+ ESM / `node --test` + `node:assert/strict` / 依存ゼロ原則（例外: `onnxruntime-node` を optionalDependencies、遅延 import）

**Spec:** `docs/superpowers/specs/2026-06-10-stackchan-streaming-voice-design.md`（Task 0 で本ブランチへ cherry-pick する）

**前提知識（zero-context 向け）:**
- リポジトリは ESM（`"type": "module"`）。テストは `npm test`（= `node --test "test/*.test.js"`）
- 既存 adapter の流儀: `createXxx({...}) → Object.freeze({...})` ファクトリ、依存はすべて引数注入（`fetchImpl` 等）。`src/adapters/index.js` を必ず一読
- StackChan ホスト側の最新コードは branch `feat/stackchan-aivis-pcm`（21 commits、Task 1 で取り込む）
- 音声は PCM16（Int16、リトルエンディアン）。WAV は 44 バイトヘッダ＋PCM

---

### Task 0: ブランチ準備

**Files:** なし（git 操作のみ）

- [ ] **Step 1: main から作業ブランチを切る**

```bash
cd ~/projects/iroharness
git checkout main && git pull --ff-only
git checkout -b feat/stackchan-streaming-voice
```

- [ ] **Step 2: 設計書コミットを取り込む**（spec は feat/cli-setup-service 上の `0fcbea4` にしか無い）

```bash
git cherry-pick 0fcbea4
ls docs/superpowers/specs/2026-06-10-stackchan-streaming-voice-design.md   # 存在すること
```

- [ ] **Step 3: 現状のテストが green なのを確認**

Run: `npm test`
Expected: all pass（落ちたら本計画より先に main の修理が要る——止めて報告）

### Task 1: gateway 資産の取り込み（移行①）

**Files:** Merge: branch `feat/stackchan-aivis-pcm`（主な着地先 `src/adapters/index.js`, `examples/slack-stackchan-companion.mjs`, `examples/aiavatar-silero-stt-worker.py`, `docs/realtime.md`, `docs/slack-stackchan.md`, `firmware/stackchan-runtime/`, `CHANGELOG.md`）

- [ ] **Step 1: マージ実行**

```bash
git merge feat/stackchan-aivis-pcm
```

- [ ] **Step 2: 競合解決**（dry-run 検証済み: `git merge-tree --write-tree main feat/stackchan-aivis-pcm` で adapters / CHANGELOG / examples / docs は**自動マージされる**。実際の競合は次の 1 ファイルのみ）

| ファイル | 原則 |
|---|---|
| `src/index.js`（5 hunks） | **deep スロット削除（gateway `c561d4b`）は gateway 側を採用**しつつ、main 側の extension hooks（turn/response フック dispatch・`let response = await brain.respond` 周り）は**残して結合**する。片側丸採用は禁止——gateway 丸採用は extension テストを、main 丸採用は gateway 由来テスト（deep 削除前提）を落とす |

⚠️ **既知の挙動変更**: このマージは「deep brain slot の廃止」を伴う（spec 非目標の「既存経路の挙動変更なし」の例外）。gateway では既に廃止済みで動いている実態の取り込みであり、CHANGELOG に明記して親方に報告すること。

- [ ] **Step 3: テストで検証**

Run: `npm test`
Expected: all pass。gateway 由来のテスト（chunk 化・正規化・session handler）が現れて通ること

- [ ] **Step 4: コミット**（マージコミットのままで可。`git log --oneline -3` で確認）

### Task 2: sentence-splitter（純関数・TDD の起点）

**Files:**
- Create: `src/voice-pipeline/sentence-splitter.js`
- Test: `test/voice-sentence-splitter.test.js`

- [ ] **Step 1: failing test を書く**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createSentenceSplitter } from "../src/voice-pipeline/sentence-splitter.js";

test("splits on Japanese terminal punctuation", () => {
  const s = createSentenceSplitter();
  assert.deepEqual(s.push("今日は晴れ"), []);
  assert.deepEqual(s.push("だよ。明日は"), ["今日は晴れだよ。"]);
  assert.deepEqual(s.flush(), ["明日は"]);
});

test("splits long clause on comma past threshold (terminal char absent)", () => {
  // option split（、）は終端文字で切れず buffer に残った文にだけ効く（本家 llm/base.py と同じ:
  // option_split は split_chars カット後の残り buffer が threshold 超のときの fallback）
  const s = createSentenceSplitter({ optionSplitThreshold: 10 });
  assert.deepEqual(s.push("あいうえおかきくけこ、さしすせ"), ["あいうえおかきくけこ、"]);
  assert.deepEqual(s.flush(), ["さしすせ"]);
});

test("handles mixed EN/JA and newline", () => {
  const s = createSentenceSplitter();
  assert.deepEqual(s.push("OK. Got it\nright"), ["OK. ", "Got it\n"]);
});

test("empty delta and flush of empty buffer", () => {
  const s = createSentenceSplitter();
  assert.deepEqual(s.push(""), []);
  assert.deepEqual(s.flush(), []);
});

test("consecutive terminal punctuation (記号連続)", () => {
  // spec §7-1 の golden case。「！？」は ！ で切れ、？ が単独フラグメントになる
  // （本家 split_chars 逐次走査と同じ挙動として固定する）
  const s = createSentenceSplitter();
  assert.deepEqual(s.push("えっ！？そうなの。"), ["えっ！", "？", "そうなの。"]);
});
```

- [ ] **Step 2: 落ちるのを確認** — Run: `node --test test/voice-sentence-splitter.test.js` / Expected: FAIL (module not found)

- [ ] **Step 3: 実装**（本家 `llm/base.py` の既定値と同じ: split_chars `。？！.?!\n`、option `、, ` は閾値 50 字超のみ）

```js
const DEFAULT_SPLIT = ["。", "？", "！", ". ", "?", "!", "\n"];
const DEFAULT_OPTION_SPLIT = ["、", ", "];

export const createSentenceSplitter = ({
  splitChars = DEFAULT_SPLIT,
  optionSplitChars = DEFAULT_OPTION_SPLIT,
  optionSplitThreshold = 50
} = {}) => {
  let buffer = "";
  const tryCut = () => {
    const sentences = [];
    let cursor = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const hit = splitChars.find((c) => buffer.startsWith(c, i));
      if (hit) {
        sentences.push(buffer.slice(cursor, i + hit.length));
        i += hit.length - 1;
        cursor = i + 1;
      }
    }
    buffer = buffer.slice(cursor);
    if (buffer.length > optionSplitThreshold) {
      const last = Math.max(
        ...optionSplitChars.map((c) => buffer.lastIndexOf(c) + (buffer.lastIndexOf(c) < 0 ? 0 : c.length))
      );
      if (last > 0) {
        sentences.push(buffer.slice(0, last));
        buffer = buffer.slice(last);
      }
    }
    return sentences;
  };
  return Object.freeze({
    push(delta) {
      buffer += String(delta || "");
      return tryCut();
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return rest ? [rest] : [];
    }
  });
};
```

- [ ] **Step 4: green 確認** — Run: `node --test test/voice-sentence-splitter.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git add src/voice-pipeline/sentence-splitter.js test/voice-sentence-splitter.test.js && git commit -m "feat(voice): sentence splitter for streaming TTS"`

### Task 3: resampler ＋ AivisSpeech `outputSamplingRate`

**Files:**
- Create: `src/voice-pipeline/resampler.js`
- Modify: `src/adapters/index.js`（`createAivisSpeechTts` に option 追加。audio_query 取得後 `audioQuery.outputSamplingRate = outputSamplingRate` を上書きしてから `/synthesis` へ）
- Test: `test/voice-resampler.test.js`、`test/adapters.test.js` に Aivis のケース追加

- [ ] **Step 1: failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { resamplePcm16 } from "../src/voice-pipeline/resampler.js";

test("downsamples 2:1 by linear interpolation", () => {
  const src = Int16Array.from([0, 100, 200, 300]);
  const out = resamplePcm16(src, 32000, 16000);
  assert.equal(out.length, 2);
  assert.equal(out[0], 0);
});

test("same rate returns same samples", () => {
  const src = Int16Array.from([1, 2, 3]);
  assert.deepEqual(Array.from(resamplePcm16(src, 16000, 16000)), [1, 2, 3]);
});
```

AivisSpeech 側（mock fetch で audio_query → synthesis の 2 呼び目 body に `"outputSamplingRate":24000` が入ることを assert）:

```js
test("createAivisSpeechTts overrides outputSamplingRate", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    if (String(url).includes("audio_query")) {
      return { ok: true, json: async () => ({ outputSamplingRate: 44100 }) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(44) };
  };
  const tts = createAivisSpeechTts({ speaker: 1, fetchImpl, outputSamplingRate: 24000 });
  await tts.stream({ text: "テスト" });
  assert.match(calls[1].body, /"outputSamplingRate":24000/);
});
```

- [ ] **Step 2: FAIL 確認** → **Step 3: 実装**（線形補間 resampler は 20 行程度。Aivis は option 1 個＋上書き 1 行）→ **Step 4: PASS 確認** → **Step 5: Commit** `feat(voice): pcm16 resampler + AivisSpeech outputSamplingRate option`

### Task 4: pacer（送出ペーシング）

**Files:**
- Create: `src/voice-pipeline/pacer.js`
- Test: `test/voice-pacer.test.js`

仕様: `createAudioPacer({ sampleRate, leadMs = 1500, nowFn, sleepFn })`。`pace(chunkSamples)` を await すると「再生時計＋lead を超えて先行しない」よう sleepFn で待つ。クロックと sleep は注入（テストは fake clock で決定論）。

- [ ] **Step 1: failing test**（fake `nowFn`/`sleepFn` で、合計 3 秒分のチャンクを一気に pace すると sleep 要求が発生し、lead 内なら sleep しないことを assert）
- [ ] **Step 2: FAIL** → **Step 3: 実装**（送出済みサンプル数から「再生上の経過時間」を計算し、`sent - elapsed > lead` のとき差分だけ sleep） → **Step 4: PASS** → **Step 5: Commit** `feat(voice): audio pacer to prevent device pool overflow`

### Task 5: metrics（段別レイテンシ）

**Files:**
- Create: `src/voice-pipeline/metrics.js`
- Test: `test/voice-metrics.test.js`

仕様: `createVoiceTurnMetrics({ nowFn })`、`mark(name)` / `snapshot()`。snapshot は `vad_close_ms / stt_ms / llm_first_sentence_ms / tts_first_audio_ms / first_audio_total_ms / total_ms` を mark 間差分で返す（mark 不足は null。`total_ms` は Task 13 の summary 用に意図的に追加）。
**決定済み**: 既存 `createRealtimeLatencyTracker` は last-wins ＆ measure() throw のため**包まずスタンドアロン実装**（first-wins と null 許容が要件。理由はモジュールヘッダに明記）。

- [ ] Step 1 failing test → Step 2 FAIL → Step 3 実装 → Step 4 PASS → Step 5 Commit `feat(voice): per-stage voice turn metrics`

### Task 6: quick-responder（即あいづち）

**Files:**
- Create: `src/voice-pipeline/quick-responder.js`
- Test: `test/voice-quick-responder.test.js`

仕様: `createQuickResponder({ tts, phrases = ["うん。"] })`。`warmup()` で全 phrase を合成しキャッシュ。`fire()` はキャッシュ済み音声イベントを即時返す（未 warmup なら null——会話を遅らせないため合成を**待たない**）。

- [ ] Step 1 failing test（mock tts、warmup 後 fire が同期で audio を返す／未 warmup は null） → Step 2 FAIL → Step 3 実装 → Step 4 PASS → Step 5 Commit `feat(voice): pre-synthesized quick responder`

### Task 7: brain streaming 契約 ＋ OpenAI Responses stream

**Files:**
- Modify: `src/adapters/index.js`（gateway 由来の OpenAI voice brain に `respondStream` 追加）
- Create: `src/voice-pipeline/brain-stream.js`（フォールバック wrapper）
- Test: `test/voice-brain-stream.test.js`

契約: `respondStream(context) → AsyncIterable<{ delta: string, emotion?: string, final?: boolean }>`。
フォールバック: `toBrainStream(brain, context)` — `respondStream` があればそれを、無ければ `respond()` の text を 1 delta で yield（劣化動作・非破壊）。
OpenAI 実装: Responses API `stream: true` の SSE を fetchImpl で読み、`response.output_text.delta` イベントを delta に写像。SSE パースは自前 1 関数（`data:` 行の JSON、`[DONE]` 終端）。

- [ ] **Step 1: failing test**（mock fetch が SSE 文字列を ReadableStream で返し、delta 列が `["今日", "は晴れ。"]` になること／`toBrainStream` フォールバックが respond-only brain で全文 1 delta になること）
- [ ] Step 2 FAIL → Step 3 実装 → Step 4 PASS → Step 5 Commit `feat(voice): streaming brain contract + OpenAI Responses SSE`

### Task 8: Codex app-server stream 対応

**Files:**
- Modify: `src/adapters/index.js`（`createCodexAppServerBrain` に `respondStream`。app-server の event stream から `agent_message_delta` 相当を delta へ）
- Test: `test/voice-brain-stream.test.js` にケース追加（mock の JSONL/event 列から delta 列を assert）

- [ ] Step 1 failing test → Step 2 FAIL → Step 3 実装 → Step 4 PASS → Step 5 Commit `feat(voice): Codex app-server streaming brain`

### Task 9: harness `receiveStream`（関所つき streaming 入口）

**Files:**
- Modify: `src/index.js`（`createIroHarness` 返却に `receiveStream` 追加。既存 `receive()` は不変）
- Modify: `src/index.d.ts`
- Test: `test/harness-receive-stream.test.js`

仕様: `receiveStream(input)` は `receive()` と同一の前段（actor 解決 → audience → permission → routing → 人格 context 構築）を通った後、brain を `toBrainStream` で開き、`{ stream, finalize }` を返す。`finalize(fullText)` が従来の state 更新（speaking → 完了）を行う。許可されない場合は `receive()` と同じ拒否挙動。

- [ ] **Step 1: failing test**（echo brain で: delta が流れる／finalize 後 state.speechText が全文になる／permission 拒否ケースが既存 receive と同型の結果になる）
- [ ] Step 2 FAIL → Step 3 実装（`receive()` の前段ロジックを関数抽出して共有。**既存 receive のテストが 1 本も落ちないこと**が DoD） → Step 4 `npm test` 全 green → Step 5 Commit `feat(harness): additive receiveStream with same gates as receive`

### Task 10: silero-vad（onnxruntime-node、遅延 import）

**Files:**
- Create: `src/voice-pipeline/silero-vad.js`
- Modify: `package.json`（`optionalDependencies: { "onnxruntime-node": "^1.x" }`）
- Test: `test/voice-silero-vad.test.js`（ort セッションは mock 注入）
- Create: `fixtures/voice/speech-16k.raw`, `fixtures/voice/silence-16k.raw`（実モデル統合テスト用、各 1 秒）

仕様: `createSileroVad({ session, sampleRate = 16000, threshold = 0.5, silenceMs = 650, minSpeechMs = 250, frameSamples = 512, nowFn })`。`push(int16Frame)` がモデル確率を読み、`{ type: "speech.start" } / { type: "speech.end", audio }` を返す。`session` は ort.InferenceSession 互換（`run()`）を注入——単体テストは確率列を返す mock。実モデル読込は `loadSileroSession({ modelPath })` を別関数にし、`onnxruntime-node` 未インストール時は導入手順つきエラー。

- [ ] **Step 1: failing test**（mock session が確率列 [0.1, 0.9, 0.9, 0.1, 0.1...] を返すとき、speech.start が 1 回、silenceMs 経過後に speech.end が出て audio が発話区間ぶんあること）
- [ ] Step 2 FAIL → Step 3 実装 → Step 4 PASS → Step 5 統合テスト（環境ゲート: `IROHARNESS_SILERO_MODEL` が設定されている時のみ実モデルで fixtures を判定。CI では skip）→ Step 6 Commit `feat(voice): Silero VAD via injectable onnx session`

**パリティ注記:** Python 版と同一モデル・同一 threshold での判定一致テストは、`examples/aiavatar-silero-stt-worker.py` の venv で参照出力を生成して fixtures に固める（手元実行手順を test ファイル冒頭コメントに書く。CI 必須にしない）。

### Task 11: pipeline オーケストレータ

**Files:**
- Create: `src/voice-pipeline/pipeline.js`、`src/voice-pipeline/index.js`（再エクスポート）
- Test: `test/voice-pipeline.test.js`

仕様: `createVoicePipeline({ vad, stt, harness, tts, queue, pacer, quickResponder, metrics, maxSentences = 30, stageTimeoutMs = { stt: 10000, brain: 30000, tts: 10000 }, onEvent })`。
（暴走ガードの**最大トークン**は pipeline ではなく brain adapter の責務: gateway 由来のオプション **`maxOutputTokens`**（env は `IROHARNESS_VOICE_BRAIN_MAX_TOKENS`）をそのまま使う。pipeline 側は文数と段別タイムアウトを持つ——二重実装しない）
入力 `pushAudio(frame)` / `interrupt(reason)`。流れ: VAD end → STT → quickResponder.fire() → `harness.receiveStream` → splitter → 文ごとに `tts.stream`（AbortSignal 持参）→ pacer 経由で `onEvent({type:"speech.audio", ...})` → 全文後 finalize。
**注意（Task 9 申し送り）**: `finalize`/`abandon` は settled ラッチ済み（二重呼び出しは null/no-op）。gate 拒否時は `{stream: null, result}` が返るので分岐すること。**barge-in では `abandon()` と AbortSignal の発火を必ずセットで行う**——abandon は状態を idle に戻すだけで brain stream は止めない（signal を忘れるとトークンを黙って燃やし続ける）。
エラー正規化: どの段の失敗も `onEvent({type:"error", stage, message})` 1 種。1 文の TTS 失敗はスキップして継続。**空白のみの文（"\n" 等、Markdown 由来）は TTS に送らずスキップ**（splitter は本家どおり素通しするので pipeline 側で濾す。テストも 1 本）。**brain が非空白文ゼロのまま final になった turn も同じ定型句経路で処理**（Codex の zero-delta turn は `{delta:"", final:true}` を返す——adapter に filler を持たせない決定済み。Task 8 レビュー参照）。brain 途中死は言いかけまで＋定型句。interrupt は進行中 brain/TTS を abort。

- [ ] **Step 1: failing test — 並走の証明**（mock brain が delta を 2 文ぶん時間差で流し、mock tts が呼び出し時刻を記録。**1 文目の tts 開始時刻 < brain 完了時刻** を assert）
- [ ] **Step 2: failing test — barge-in**（再生中に interrupt → tts の signal.aborted が true、`speech.interrupted` イベント。**自動 barge-in も**: speaking 中の pushAudio で VAD が speech.start を返したら同様に abort されること）
- [ ] **Step 3: failing test — エラー継続**（2 文中 1 文目の tts が throw → 2 文目は喋る、error イベント 1 個）
- [ ] **Step 4: failing test — 暴走ガード**（maxSentences=2 で 3 文目が出ない）
- [ ] Step 5 まとめて FAIL 確認 → Step 6 実装 → Step 7 PASS → Step 8 Commit `feat(voice): streaming voice pipeline orchestrator`

### Task 12: session handler 統合（薄い皮化）

**Files:**
- Modify: `src/adapters/index.js` の `createStackChanRealtimeSessionHandler`（内部を pipeline 呼び出しに置換。WS メッセージ⇔pipeline イベントの変換だけ残す。受け口の message 型・送り口の message 型は**一切変えない**＝ファーム互換維持）
- Modify: `examples/slack-stackchan-companion.mjs`（pipeline 組み立てに差し替え、`IROHARNESS_VOICE_MAX_SENTENCES` 等の env 追加）
- Test: 既存 `test/adapters.test.js` の session handler テストが**そのまま通る**こと＋first_audio metrics がイベントに乗るケース追加＋**STT 空振り時に `stt.empty` を送って listening に復帰する挙動（gateway `90a0ea0` 由来）がリファクタ後も残る**ことの assertion＋**WS 切断で進行中 tts の signal が aborted になる**ことの assertion（spec §6「WS 切断 → abort」）

- [ ] Step 0 **実モデル関所**（→ 開発機でダウンロード不可のため**移行④の Mac mini 上で実施**に変更）: silero_vad.onnx を取得し `IROHARNESS_SILERO_MODEL=... node --test test/voice-silero-vad.test.js` で gated smoke test を一度通す（sr テンソルの scalar dims を実グラフで確認。Task 10 レビュー Minor 5）
- [ ] Step 1 既存テスト green を確認（リファクタ前の基準）→ Step 2 置換実装 → Step 3 `npm test` 全 green → Step 4 Commit `refactor(voice): session handler delegates to voice pipeline (wire format unchanged)`

### Task 13: E2E（疑似実機お会計）＋ docs

**Files:**
- Modify: `examples/stackchan-realtime-simulator.mjs`（`--summary` に first_audio_total_ms 表示を追加）
- Modify: `docs/realtime.md`（streaming pipeline 節）、`docs/stackchan-firmware.md`（「not copied yet」の古い記述を実態に更新）、`docs/capability-matrix.md`、`CHANGELOG.md`
- Create: `docs/aiavatarkit-parity.md`（spec §7-5 のパリティ対照表: AIAvatarKit 機能 × IroHarness 実装 × 対応テスト名。会話パイプライン範囲のみ、wakeword 等は「非目標」行として明記）
- Test: 手動 E2E

- [ ] **Step 1: E2E 実行**

```bash
SLACK_BOT_TOKEN=dummy SLACK_SIGNING_SECRET=dummy STACKCHAN_DEVICE_TOKEN=devtoken \
PORT=4210 IROHARNESS_STACKCHAN_STT_PROVIDER=mock IROHARNESS_STACKCHAN_TTS_PROVIDER=mock \
npm run example:slack-stackchan &
node examples/stackchan-realtime-simulator.mjs --url ws://127.0.0.1:4210/device/stackchan/realtime --token devtoken --summary
```

Expected: 会話成立＋summary に first_audio_total_ms が出る（mock なので値は小さい。**実機 1.5 秒目標の検証は移行④＝Mac mini 配備後**）

- [ ] Step 2 docs 更新 → Step 3 `npm test` 最終 green → Step 4 Commit `docs(voice): streaming pipeline docs + fix stale firmware note`

---

### Task 14: 動的 quick responder（本家 QuickResponder パリティ・親方承認 2026-06-11）

**Files:** Modify: `src/voice-pipeline/quick-responder.js`（`createDynamicQuickResponder` 追加）, `src/voice-pipeline/pipeline.js`（fireFor 対応＋buildInput への quickText 受け渡し）, `examples/slack-stackchan-companion.mjs`（env 配線＋continuation prefix）/ Test: 各対応テスト

本家の仕掛け: 別口の超軽量 LLM 呼び（≤10文字・timeout 1.5s・失敗時は静的句へフォールバック）で文脈連動の第一声を生成し、本命 brain には「既に『{第一声}』と言った。繰り返さず続きから。外していたら続きで軌道修正」と指示を添える（quick_responder/base.py + pro.py 参照）。

- [x] dynamic responder 単体（mock brain: 速い→動的句 / timeout→静的 fallback / error→fallback）
- [x] pipeline: `fireFor(transcript, {signal})` があれば優先、無ければ既存 `fire()`。ack 発話と receiveStream 開始の順序は本家同様 ack 確定後（quickText を buildInput 第2引数 `{quickText}` で渡す＝additive）
- [x] companion: `IROHARNESS_STACKCHAN_QUICK_MODE=dynamic|static`（既定 static・非破壊）、continuation prefix は本家 JA 文面準拠
- [x] E2E で ack が文脈連動になることを mock brain で確認（pipeline テストで実 dynamic responder + mock brain を結線して検証）

### Task 15: Azure streaming STT（真ストリーミング・親方承認 2026-06-12）

**決定**: 本家 `AzureStreamSpeechDetector`（azure_stream.py）同等を Node で。両方式選択可・**既定は新方式**。SDK は `microsoft-cognitiveservices-speech-sdk`（optionalDependencies・遅延 import、onnxruntime と同じ流儀）。

**設計**:
- 新抽象「speech detector」: `detector.push(int16Frame) → events`（`speech.start` / `transcript.partial` / `speech.end {text}`）。VAD と STT を一体で扱う
- Mode `azure-stream`: SDK の PushAudioInputStream + recognizing/recognized イベント。**サブモード2つ**: `gated`（既定。Silero が speech.start した発話区間＋preroll だけ Azure に流す＝課金は発話分のみ）/ `continuous`（本家同等・常時流し。マイク時間で課金、デバイスの mic ON/OFF が財布のスイッチ）
- Mode `silero-batch`: 既存（SileroVad＋batch STT を detector 契約に wrap、互換維持）
- pipeline: `detector` を受け取れるように（speech.end に text が乗っていれば transcribe() をスキップ）。partial は `onEvent({type:"stt.partial"})` → session handler が legacy `stt.event` wire を送出（**streaming mode の partial 欠落 divergence をここで解消**）
- env: `IROHARNESS_STACKCHAN_DETECTOR=azure-stream|silero`（既定: AZURE_SPEECH_KEY があれば azure-stream、無ければ silero に fallback＋ログ）、`IROHARNESS_STACKCHAN_AZURE_STREAM_MODE=gated|continuous`（既定 gated）

- [x] detector 契約＋silero-batch wrap（既存テスト緑のまま）
- [x] azure-stream detector（SDK は mock 注入で単体テスト。recognizing→partial、recognized→speech.end+text、segmentation timeout 設定、再接続）
- [x] gated サブモード（Silero 前置・preroll 付き・発話区間のみ push）
- [x] pipeline / session handler / example 配線＋partial wire 送出
- [x] docs（realtime.md・課金特性の明記）

## スコープ外（別計画）

- **移行③ ファーム分離**（`iroharness-stackchan-firmware` リポジトリ新設）— GitHub リポジトリ作成を伴う荒事。別の小計画で
- **移行④ 実機計測**（Mac mini 配備・レイテンシ実測・チューニング）— 本計画完了後
- wakeword / 話者識別 / 会話録音（spec 非目標）

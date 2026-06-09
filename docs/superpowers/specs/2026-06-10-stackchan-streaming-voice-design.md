# StackChan Streaming Voice Pipeline — Design

作成日: 2026-06-10
状態: 親方承認済み設計（実装計画は別途 Plans.md）
関連: docs/stackchan-firmware.md, docs/realtime.md, docs/absorption-architecture.md

## 1. 背景と問題

StackChan 実機運用で 2 つの問題が確認された。

1. **レイテンシが遅い**: 現行の voice 経路は VAD 締め → STT(バッチ) →
   brain(全文生成待ち) → TTS(全文一括合成) → 送出が完全直列で、
   最初の音が出るまで返答全体の長さに比例した時間がかかる（実測 3〜9 秒級）。
2. **TTS がちゃんと話せない**: ホストが TTS 音声を無ペーシングで一斉送信し、
   ファーム側再生プールが溢れると残りを破棄する。AivisSpeech 出力（44.1kHz）の
   リサンプル無し素通しがプール消費を悪化させる。

参照実装 AIAvatarKit（Python, uezo/aiavatarkit）の `STSPipeline` は
「LLM ストリームを文で切り、1 文ずつ TTS して即送出」する構造で、
最初の音までの時間が **最初の 1 文分** で済む。本設計はこの仕組みを
Node.js（IroHarness 本流）に移植する。

**制約（親方指示）**: 「Python にできて Node にできないことを残さない」。

## 2. 決定事項（brainstorming で確定）

| 論点 | 決定 |
|---|---|
| 実装言語/場所 | Node。本流 monorepo（~/projects/iroharness）の `src/voice-pipeline/` 新設 |
| リポジトリ構成 | ホスト＋契約は本流 monorepo。ファームは新リポジトリ `iroharness-stackchan-firmware` に分離（absorption-architecture.md の分離トリガー「toolchain forces it」発動） |
| 人格の SSOT | 従来どおりホスト機のプロファイル（SOUL.md 等）。ファームは人格を持たない。avatar-packs は「衣装」としてファーム側可、感情→顔マッピング規則の正本は本流 `protocols/` |
| VAD | Silero VAD を onnxruntime-node で Node 移植（Python ワーカー廃止） |
| パリティ範囲 | 会話パイプラインの完全パリティ。wakeword・話者識別・会話録音・動的設定 API は後続タスク化のみ |
| voice brain | OpenAI Responses API（SSE stream）主軸 ＋ Codex app-server（event stream）同時対応 |
| アプローチ | 案 1: VoicePipeline モジュール新設（本家 STSPipeline の Node 対応物）。人格・権限・状態は既存 macro harness を必ず経由 |

## 3. アーキテクチャ

```
[StackChan 実機: AIAvatarStackChan ファーム（変更なし）]
   マイク PCM ──WS(data)──▶ ホスト
   スピーカー ◀─WS(chunk)── ホスト

[Mac mini ホスト: Node 1 プロセス]
   session handler（WS プロトコル変換の薄い皮）
        │
   VoicePipeline（新設）
        VAD(Silero/onnx) → STT → [harness 関所] → brain(respondStream)
          → sentence-splitter → 逐次 TTS → pacer → 送出
        │
   macro harness（人格・audience・permission・PJOS・状態配信）
        └─ Slack / browser / OBS へ同一状態を同期
```

- WS プロトコルは本家 AIAvatarStackChan 互換のまま。ファーム変更ゼロ。
- 「harness 関所」: 毎ターン、audience 解決 → permission 判定 →
  人格コンテキスト付与 → routing を既存 harness 経由で行う。
  パイプライン内に人格・権限・記憶を持たせない。

### 1 ターンのシーケンス

1. ファームが PCM チャンクを常時送信（現行どおり）
2. ホスト側 Silero VAD が発話開始/終了（無音 650ms）を判定
3. 発話区間を STT（OpenAI）へ → トランスクリプト確定
4. quick-responder が事前合成済みあいづち（「うん。」）を即送出
5. harness 関所を通って voice brain が **streaming** 生成開始
6. sentence-splitter が「。？！.?!\n」（50 字超は「、」も）で文を閉じる
7. 閉じた文を即 TTS（AivisSpeech, `outputSamplingRate` 指定）→
   pacer が再生時計に合わせて chunk 送出。**この間 brain は次の文を生成中**
8. 全文完了で `final`。harness が状態を speaking → idle に戻す

最初の音まで ＝ VAD 締め + STT + 1 文目生成 + 1 文目合成。
返答全体の長さに依存しない。

### barge-in

再生中に VAD が新規発話を検知 → パイプラインが進行中の brain/TTS を
AbortSignal で中断 → 実機へ `stop` → ファームが再生キューを破棄。

## 4. コンポーネント（src/voice-pipeline/）

すべて依存注入で単体テスト可能にする。本家対応物を併記。

| ファイル | 役目 | AIAvatarKit 対応 |
|---|---|---|
| `silero-vad.js` | onnxruntime-node で Silero 推論。`push(pcm)` → `speech.start`/`speech.end`。無音閾値はコンストラクタ引数（本家 default 0.5s、現行運用 650ms。パリティテストは同値で突き合わせる） | `sts/vad/silero.py` |
| `sentence-splitter.js` | 純関数。delta 蓄積と文切り出し。`push(delta)→string[]`, `flush()` | `sts/llm/base.py` split |
| `pacer.js` | 音声チャンクの送出ペーシング（実機プール溢れ防止）。再生時計比でリード量を制御 | （本家は暗黙） |
| `resampler.js` | PCM16 線形リサンプル。AivisSpeech はエンジン側 `outputSamplingRate` を優先し、これはフォールバック | `sts/tts/converter.py` |
| `quick-responder.js` | あいづちの事前合成キャッシュと即時発射 | `sts/quick_responder/` |
| `metrics.js` | 段別レイテンシ計測: `vad_close_ms` / `stt_ms` / `llm_first_sentence_ms` / `tts_first_audio_ms` / `first_audio_total_ms` | `sts/performance_recorder/` |
| `pipeline.js` | 上記を束ねるオーケストレータ。1 セッション 1 インスタンス | `sts/pipeline.py` |

## 5. 契約の変更（すべて追加・非破壊）

既存リポジトリ方針「既存 IroHarness API は変更せず足すだけ（非破壊）」
（Plans.md 冒頭の一般方針。なお現 Plans.md は Agent Bank 構想専用のため、
本件の実装計画は別ファイルとして writing-plans で作成する）に従う。

1. **brain**: 任意メソッド `respondStream(context) → AsyncIterable<{delta, emotion?, final?}>`
   を追加。`respond()` のみの brain は全文 1 文扱いで動作（劣化動作、非破壊）。
   - 対応 adapter: OpenAI Responses（SSE）, Codex app-server（event stream）
2. **harness**: `receiveStream()` を追加。`receive()` と同一の関所
   （audience → permission → 人格コンテキスト → routing）を通過後に
   stream を返す。既存 `receive()` は不変。
3. **TTS**: `createAivisSpeechTts` に `outputSamplingRate` オプション追加
   （audio_query 結果の上書き。エンジン側リサンプル）。

## 6. エラー処理

| 事象 | 振る舞い |
|---|---|
| 1 文の TTS 失敗 | その文だけスキップして次の文へ。会話は止めない。metrics に記録 |
| brain ストリーム途中死 | 言いかけの文まで発話し、quick-responder から定型句（「少々調子が悪いや」）を発射（graceful recovery, agent-bank.md §6.3 と同思想） |
| WS 切断 | パイプライン abort。進行中の brain/TTS リクエストを AbortSignal で中断（コスト垂れ流し防止） |
| STT 空振り | `stt.empty` 送出、状態を listening に戻す |
| 暴走ガード | 1 返答の最大文数・最大トークンを設定可能に |
| 共通 | 各段タイムアウト。どの段の失敗も `error` イベント 1 種に正規化して実機へ |

## 7. テスト戦略（TDD）

1. **sentence-splitter**: golden ケース（日英混在・「、」閾値・記号連続・空 delta）。
   本家と同入力で出力一致を確認
2. **silero-vad**: 無音/発話 PCM フィクスチャで Python 版 Silero と判定一致
   ＝ パリティの物証
3. **pipeline**: mock STT/brain/TTS でイベント順序検証。
   「1 文目の TTS 中に 2 文目の生成が進む」並走の検証を含む
4. **E2E**: `examples/stackchan-realtime-simulator.mjs` を拡張し、
   `first_audio_total_ms`・ペーシング・barge-in を疑似実機で計測
5. **パリティ対照表**: AIAvatarKit 機能対照表を docs に置き、
   各行をテスト名に紐づける（漏れの可視化）

## 8. 移行手順

```
① gateway 作業ツリーのホスト側資産を本流へ取り込み
   （チャンク化・本家プロトコル互換・レイテンシ計測・即あいづち・
    OpenAI STT adapter・OpenAI Responses voice brain。
    ※ OpenAI 系 adapter は本流に未収載＝① の取り込み対象であり ② の新規実装ではない）
② voice-pipeline 実装（TDD、シミュレータ検証）
③ ファームを iroharness-stackchan-firmware リポジトリへ分離
   （上流 AIAvatarStackChan の fork として追従可能に。
    LICENSE.aiavatarstackchan / THIRD_PARTY_NOTICES.md を維持）
④ Mac mini 実機配備・計測（目標: first_audio_total ≤ 1.5 秒）
```

①② が本丸、③ は並行可、④ が検証ゲート。
gateway 作業ツリー（~/Documents/Codex/...）は移行完了後に畳む。

## 9. 非目標

- wakeword / 話者識別 / 会話録音 / 動的設定 API（後続タスク化のみ）
- ファームウェアの機能変更（プロトコル互換を維持）
- 既存 Slack / browser / text 経路の挙動変更

## 10. 修正すべき既存ドキュメントの不整合

- `docs/stackchan-firmware.md` の「IroHarness has not copied source code from
  AIAvatarStackChan yet」記述は実態（gateway でファーム丸ごと取り込み済み）と
  乖離。③ の分離時に更新する。

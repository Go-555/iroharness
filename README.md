# IroHarness

IroHarness は「最強の相棒AI」を作るための Character Macro Harness です。

ひとつの人格を中心に置き、その人格を Slack、Web、VS Code、OBS配信、
Discord、YouTube、M5Stack、Even G2、Live2D、MotionPNGTuber、VRM/3D など
複数の身体や入口に接続します。Codex、Claude Code、OpenClaw、Hermes、
OpenClaude のような実働エージェントは、人格そのものではなく、
必要な仕事を任せる micro harness として扱います。

基本思想はこれです。

```text
Character Macro Harness
  = identity + memory + Project OS + realtime state + expression bodies
    + model routing + micro-harness delegation
```

IroHarness は、すべてのエージェント実行基盤を置き換えるものではありません。
それらの上に立って、人格、状態、権限、身体表現、仕事の委譲をまとめる層です。

```text
Slack / Web / VS Code / M5Stack / Even G2 / Live2D / MotionPNGTuber
                              |
                              v
                         IroHarness
        identity, state, PJOS, routing, approvals, expression
                              |
        +---------------------+---------------------+
        v                     v                     v
      Codex               OpenClaw               Hermes
  micro harness        micro harness         learning agent
```

## いま何ができるか

現在の IroHarness は、まだ完成品の商用アプリではなく、OSSとして育てるための
基盤パッケージです。ただし、すでに次の機能があります。

| 領域 | できること |
|---|---|
| 人格の中心管理 | `SOUL.md`、`IDENTITY.md`、`MEMORY.md`、`VOICE.md` を読み込み、同じ人格を複数の入口で使える |
| Project OS | goals、stories、specs、tickets、runs、artifacts を永続状態として扱える |
| モデル切り替え | voice / text / deep / work の brain slot を分け、音声は軽量、テキストは高品質、深い議論は強いモデルにできる。text/deep brain は Codex OAuth 経由の model 選択にも対応 |
| micro harness 委譲 | Codex app-server、Claude Code CLI、OpenClaw、Hermes、HTTP worker、JSONL process、text process に仕事を投げる adapter がある |
| ブラウザ companion | ローカルWeb UI、OBS overlay、audience admin、SSE event stream、OpenAPI を持つ開発サーバーを起動できる |
| 配信・Slack対応 | OBS Browser Source、OBS WebSocket、YouTube Live Chat polling、Discord bot、Slack Events、Slack + Codex companion の実装例がある |
| ユーザー管理 | YouTube ID、Discord ID、Slack ID、browser user などを同一人物に紐づけられる |
| 権限制御 | deep discussion、delegate_work、manage_stream、manage_users などを role と permission override で制御できる |
| 身体 adapter | MotionPNGTuber、M5Stack、Even G2、Live2D、VRM/3D、AIAvatarKit への状態マッピングがある |
| StackChan実機 | `/stackchan/face`、`/device/stackchan/invoke`、最小PlatformIO face poller sketch がある |
| realtime 音声契約 | STT partial、TTS chunk、barge-in、latency tracking を扱う JS contract がある |
| Rust fast path | `crates/realtime-core` に native/WASM C ABI 対応の realtime core がある |
| 生成アプリ | `npx iroharness init` で相棒AIアプリのひな形を作れる |
| 運用準備 | doctor、production doctor、OSS readiness、publish preflight、GitHub Actions、npm release workflow がある |
| PostgreSQL/Supabase | audience、identity、permission、stream session、audit log 用のSQL schemaとbackup/restore例がある |
| 吸収設計 | CursorTuberKit、Neuro SDK、AIAvatarStackChan などの思想を contract / adapter / simulator として吸収する設計がある |

詳しい一覧は [docs/capability-matrix.md](./docs/capability-matrix.md) を見てください。

## なぜ作るのか

OpenClaw は personal AI gateway として強いです。Hermes は learning agent として
強いです。AIAvatarKit は speech-to-speech avatar framework として強いです。

IroHarness が中心に置くものは少し違います。

- キャラクターそのものをプロダクトの中心にする
- 同じ人格を Live2D、MotionPNGTuber、VRM/3D、M5Stack、Even G2、VS Code、
  Slack、Discord、ブラウザ avatar に出せるようにする
- 音声会話、テキスト会話、深い議論、作業実行でモデルを分けても人格が壊れないようにする
- Project OS に goals、specs、tickets、runs、artifacts を残し、会話ログだけに依存しない
- micro harness には専門作業を任せ、macro harness が人格と関係性を所有する
- YouTube、Discord、Slack、ブラウザ上のIDを同じユーザーとして扱い、ファン、開発者、
  管理者の権限を分ける

境界の考え方は [docs/design-principles.md](./docs/design-principles.md) にあります。
新しい連携を追加したい場合は [docs/build-an-adapter.md](./docs/build-an-adapter.md) を
見てください。
SlackからCodexへ委譲する最初の実運用形は
[docs/slack-codex.md](./docs/slack-codex.md) にあります。
SlackとStackChanを同じ人格につなぐ最初のハードウェア実験は
[docs/slack-stackchan.md](./docs/slack-stackchan.md) にあります。

近いOSSから何を学び、何を取り込まないかは
[docs/inspiration-map.md](./docs/inspiration-map.md) と
[docs/inspiration-map.html](./docs/inspiration-map.html) にまとめています。
モノレポ内でどう吸収するかは
[docs/absorption-architecture.md](./docs/absorption-architecture.md) です。

## ステータス

このリポジトリは、Character Macro Harness のOSS基盤です。
Node.js の依存なしコアで protocol を読みやすく保ちつつ、低レイテンシーが必要な
音声、デバイス、イベントループのために Rust realtime core も用意しています。

CI は Node check、Node test、package contents、Rust realtime core crate を検証します。
詳細は [docs/ci.md](./docs/ci.md) を見てください。

OSS運用については [RELEASE.md](./RELEASE.md)、[CHANGELOG.md](./CHANGELOG.md)、
[SECURITY.md](./SECURITY.md) を見てください。コントリビュート前には
[CONTRIBUTING.md](./CONTRIBUTING.md) と
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) も確認してください。
人格メモリ、ユーザーID、認証情報、配信権限の扱いは
[docs/privacy-and-security.md](./docs/privacy-and-security.md) にあります。

## インストール

OpenClawのように、GitHubから1コマンドで入れる導線を用意しています。
npm公開前の推奨は GitHub install です。

```bash
curl -fsSL https://raw.githubusercontent.com/Go-555/iroharness/main/install.sh | bash
```

これは `~/.iroharness/source` にOSS本体を入れ、
`~/iroharness-apps/iroha` に個人用の相棒アプリを作ります。
詳しくは [docs/install.md](./docs/install.md) を見てください。

手動でリポジトリを触る場合:

```bash
npm install
```

現時点では runtime dependency はありません。
core、adapters、testing contracts の TypeScript declarations を同梱しています。

## Quick Start

ローカルで相棒AIアプリを作ります。

```bash
npx iroharness init ./my-companion --character Iroha
cd my-companion
npm install
cp .env.example .env
npm run doctor
npm start
```

通常は次のURLが表示されます。

```text
http://127.0.0.1:4178/
```

生成アプリの主な route です。

- `/`: ブラウザ chat
- `/?view=overlay`: OBS Browser Source 用 overlay
- `/?view=admin`: audience、platform IDs、permissions、streams の管理画面
- `/health`: readiness と runtime status
- `/openapi.json`: ローカルHTTP API contract

Mac mini、Linux、Tailscale、reverse proxy で動かす例は
[docs/deployment.md](./docs/deployment.md) と
[examples/deployment](./examples/deployment) にあります。

`.env` に `YOUTUBE_API_KEY` と `YOUTUBE_LIVE_CHAT_ID` を入れると YouTube live chat
polling が動きます。`DISCORD_BOT_TOKEN` を入れると Discord runtime が動きます。
`IROHARNESS_ENABLE_OBS=1` を入れると OBS WebSocket stream control が有効になります。

## Generated App Checklist

ファンや共同開発者を招待する前に確認してください。

```bash
npm run doctor
npx iroharness audience list . --json
npx iroharness audience export . --file ./audience-backup.json
IROHARNESS_ADMIN_TOKEN="$(openssl rand -hex 24)" npm run doctor:production
```

生成アプリには `AGENTS.md` が含まれます。これにより、Codex や Claude Code のような
coding agent / micro harness がリポジトリに入っても、人格そのものを勝手に所有しない
前提を共有できます。

確認項目です。

- `AGENTS.md` と `SOUL.md`、`IDENTITY.md`、`MEMORY.md`、`VOICE.md` を編集する
- OBS は `http://127.0.0.1:4178/?view=overlay` を Browser Source に設定する
- YouTube user と Discord user が必要に応じて同じ人物に解決される
- `delegate_work`、`manage_stream`、`manage_users` は信頼できるユーザーだけに付ける
- audience backup は private に扱い、git に入れない
- Tailscale、tunnel、reverse proxy で外に出す前に `IROHARNESS_ADMIN_TOKEN` を設定する
- deployment は launchd、systemd、Tailscale、reverse proxy の例に従う

配信やDiscordコミュニティで使う前に、platform ID を紐づけます。

```bash
npx iroharness audience user . \
  --id owner \
  --display-name "Owner" \
  --role owner \
  --youtube UCxxx \
  --discord 123456

npx iroharness audience stream . \
  --id youtube-live \
  --platform youtube \
  --channel "$YOUTUBE_LIVE_CHAT_ID" \
  --host owner

npx iroharness audience list . --json
```

## サンプル実行

リポジトリ内の例を実行できます。

```bash
npm run example
npm run example:audience
npm run example:audience-admin
npm run example:adapter
npm run example:bodies
npm run example:brain-gateway
npm run example:provider-brain-gateway
npm run example:brains
npm run example:pjos
npm run example:codex
npm run example:claude
npm run example:discord
npm run example:slack-codex
npm run example:slack-stackchan
npm run example:bridges
npm run example:slack
npm run example:youtube
npm run example:obs
npm run example:realtime-core
npm run e2e:browser-screenshots
npm run smoke:generated-app
npm run oss:ready
npm run oss:publish-preflight
npm run demo:browser
```

CLIの詳細は [docs/cli.md](./docs/cli.md) を見てください。
browser screenshot E2E は [docs/ci.md](./docs/ci.md) にあります。

## Core API

最小構成の例です。

```js
import {
  createIroHarness,
  createFileProjectOs,
  createConsoleDevice,
  createEchoBrain,
  createHeuristicRouter,
  createStubMicroHarness
} from "iroharness";

const projectOs = createFileProjectOs({ path: ".iroharness/pjos.json" });

const iroha = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "A practical, warm character companion who helps with work.",
    voiceStyle: "short, natural, responsive"
  },
  projectOs,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  devices: [createConsoleDevice("console")],
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"])
  ]
});

await iroha.receive({
  source: "web",
  modality: "text",
  text: "この機能をCodexで実装して"
});
```

## Adapter Examples

OpenClaw や Hermes のようなHTTP runtimeをつなげます。

```js
import { createHttpMicroHarness } from "iroharness/adapters";

const openclaw = createHttpMicroHarness({
  id: "openclaw",
  endpoint: "http://127.0.0.1:8787/run",
  capabilities: ["assistant", "tools", "memory"]
});
```

名前付きの外部bridgeもあります。

```js
import {
  createOpenClawMicroHarness,
  createHermesGatewayMicroHarness,
  createAIAvatarKitBridgeDevice
} from "iroharness/adapters";

const openclaw = createOpenClawMicroHarness({
  endpoint: "http://127.0.0.1:8787/agent/run"
});

const hermes = createHermesGatewayMicroHarness({
  endpoint: "http://127.0.0.1:8765/message"
});

const avatar = createAIAvatarKitBridgeDevice({
  eventEndpoint: "http://127.0.0.1:8000/iroharness/events"
});
```

詳しくは [docs/external-bridges.md](./docs/external-bridges.md) を見てください。

独自adapterは、接続前に contract test できます。

```js
import { assertMicroHarnessContract } from "iroharness/testing";

await assertMicroHarnessContract(adapter, {
  task: fixture.task,
  context: fixture.context
});
```

詳細は [docs/adapter-contract-testing.md](./docs/adapter-contract-testing.md) です。

JSONL worker process も接続できます。

```js
import { createJsonlProcessMicroHarness } from "iroharness/adapters";

const hermes = createJsonlProcessMicroHarness({
  id: "hermes",
  command: "node",
  args: ["./workers/hermes-bridge.mjs"],
  capabilities: ["learning", "skills"]
});
```

Claude Code を coding micro harness として呼ぶ例です。

```js
import { createClaudeCodeCliMicroHarness } from "iroharness/adapters";

const claudeCode = createClaudeCodeCliMicroHarness({
  cwd: "/path/to/project",
  args: ["-p"]
});
```

guard付き example を実行します。

```bash
IROHARNESS_RUN_CLAUDE=1 CLAUDE_WORKSPACE=/path/to/project npm run example:claude -- "Claude Codeで設計レビューして"
```

Codex app-server 委譲の例です。

```bash
IROHARNESS_RUN_CODEX=1 CODEX_WORKSPACE=/path/to/project npm run example:codex -- "CodexでREADMEをレビューして"
```

詳細は [docs/codex.md](./docs/codex.md) を見てください。

Slackで会話しながらCodexへ委譲する例です。Codex認証はMac miniや常駐ホストで
`codex login` しておき、Slack userごとの許可はIroHarnessのaudience registryで見ます。

```bash
codex login

SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
SLACK_BOT_USER_ID=UIROHA \
IROHARNESS_RUN_CODEX=1 \
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER \
CODEX_WORKSPACE=/path/to/project \
npm run example:slack-codex
```

詳細は [docs/slack-codex.md](./docs/slack-codex.md) を見てください。

Slackで話しかけると同じcharacter stateをStackChan風のM5Stack faceへ出す例です。

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
SLACK_BOT_USER_ID=UIROHA \
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER \
npm run example:slack-stackchan
```

StackChan側はまず `GET /stackchan/face` をpollするだけで試せます。
詳細は [docs/slack-stackchan.md](./docs/slack-stackchan.md) を見てください。
実機ファームウェアの吸収方針は
[docs/stackchan-firmware.md](./docs/stackchan-firmware.md) にまとめています。
最小PlatformIO sketchは [examples/stackchan-face-poller](./examples/stackchan-face-poller) です。

## Brain Routing

IroHarness は人格とモデル選択を分離します。

- `voice`: 低レイテンシー、短い返答、割り込み前提
- `text`: Slack、Discord、Web chat 用の自然な会話
- `deep`: 開発者との深い議論、設計、戦略、調査
- `work`: Codex、Claude Code、OpenClaw、Hermes などへの作業委譲

例です。

```bash
npm run example:brains
npm run example:brain-gateway
npm run example:provider-brain-gateway
```

Codex OAuth 済みのホストでは、text/deep brain 自体をCodex modelにできます。

```bash
codex login

IROHARNESS_TEXT_BRAIN_PROVIDER=codex \
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.4 \
IROHARNESS_DEEP_BRAIN_PROVIDER=codex \
IROHARNESS_DEEP_BRAIN_MODEL=gpt-5.5 \
npm run example:slack-codex
```

生成アプリでは `.env` から brain slot ごとに model gateway を指定できます。

```bash
IROHARNESS_VOICE_BRAIN_ENDPOINT=http://127.0.0.1:8788/voice
IROHARNESS_TEXT_BRAIN_ENDPOINT=http://127.0.0.1:8788/text
IROHARNESS_DEEP_BRAIN_ENDPOINT=http://127.0.0.1:8788/deep
IROHARNESS_BRAIN_AUTH_TOKEN=optional-bearer-token
```

`example:brain-gateway` は dependency-free のローカルHTTP gatewayです。
`example:provider-brain-gateway` は同じ contract で OpenAI Responses、
Anthropic Messages、local OpenAI-compatible chat completions server に振り分けます。

詳細は [docs/brains.md](./docs/brains.md) を見てください。

## Realtime Voice

音声リアルタイム系の contract もあります。

```js
import {
  createJavascriptRealtimeCore,
  createRealtimeLatencyTracker,
  createRealtimeVoiceSession,
  createRustRealtimeCoreBinding,
  createTextStreamingStt,
  createTextStreamingTts
} from "iroharness";
```

詳細は [docs/realtime.md](./docs/realtime.md) です。

外部 realtime core process の例です。

```bash
npm run example:realtime-core
```

これは将来の Rust や Go fast path と同じ runtime core contract を使います。

## Platform Adapters

Discord、Slack、YouTube の入力は、人格、権限、micro harness 委譲に入る前に
正規化されます。

```js
import {
  createDiscordMessageAdapter,
  createSlackMessageAdapter,
  createYouTubeLiveChatAdapter
} from "iroharness/adapters";

const discord = createDiscordMessageAdapter({ mentionOnly: true });
const slack = createSlackMessageAdapter({ mentionOnly: true });
const youtube = createYouTubeLiveChatAdapter();
```

stream-aware permissions を使う場合は、正規化後に stream context を付けます。

```js
import {
  createSnapshotStreamSessionResolver,
  createStreamContextEnricher
} from "iroharness/adapters";

const enrichTurn = createStreamContextEnricher({
  resolveStreamSession: createSnapshotStreamSessionResolver({
    snapshot: () => userRegistry.snapshot()
  })
});
```

実際の platform runtime 例です。

```bash
YOUTUBE_API_KEY=... YOUTUBE_LIVE_CHAT_ID=... npm run example:youtube
DISCORD_BOT_TOKEN=... DISCORD_BOT_USER_ID=... npm run example:discord
SLACK_BOT_TOKEN=... SLACK_BOT_USER_ID=... npm run example:slack
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455 OBS_OVERLAY_INPUT="IroHarness Overlay" npm run example:obs
```

dev server には次の endpoint もあります。

```text
POST /platform/discord/message
POST /platform/slack/message
POST /platform/youtube/message
GET  /platforms
```

詳細は [docs/platform-adapters.md](./docs/platform-adapters.md) です。

## Audience Registry

YouTube、Discord、Slack、VS Code、browser、M5Stack、Even G2 のIDを、
同じ durable user に紐づけられます。role と permission override によって、
その人ができることを制御します。人格は変わりません。

```bash
npm run example:audience
```

詳細は [docs/audience-data-model.md](./docs/audience-data-model.md) と
[docs/audience-and-permissions.md](./docs/audience-and-permissions.md) を見てください。
OBS、YouTube配信、Discordファンコミュニティ運用は
[docs/streaming-community.md](./docs/streaming-community.md) にあります。

dev server では、`userRegistry` を渡すことで次の local audience management endpoint
も使えます。

```text
GET  /audience
GET  /audience/resolve
POST /audience/users
POST /audience/users/:userId/identities
POST /audience/users/:userId/permissions
```

外部から到達できるサーバーにする場合は `adminToken` を設定してください。

browser demo 起動中に別shellから seed できます。

```bash
IROHARNESS_URL=http://127.0.0.1:4178 npm run example:audience-admin
```

長期運用では `protocols/sql/postgres-audience.sql` の PostgreSQL/Supabase schema を使えます。

```text
iroharness_users
iroharness_user_identities
iroharness_permission_overrides
iroharness_stream_sessions
iroharness_audit_log
```

backup / restore は [docs/postgres-backup-restore.md](./docs/postgres-backup-restore.md) と
`examples/postgres-audience-backup.sh` /
`examples/postgres-audience-restore.sh` を使います。

core からは `pg` 互換の query 関数で使えます。

```js
import { createPostgresUserRegistry } from "iroharness";

const userRegistry = createPostgresUserRegistry({
  query: (sql, params) => pool.query(sql, params)
});
```

## Browser Avatar Demo

起動します。

```bash
npm run demo:browser
```

model-slot routing をローカルで試す場合は、別shellで demo brain gateway を起動します。

```bash
npm run example:brain-gateway
IROHARNESS_VOICE_BRAIN_ENDPOINT=http://127.0.0.1:8788/voice \
IROHARNESS_TEXT_BRAIN_ENDPOINT=http://127.0.0.1:8788/text \
IROHARNESS_DEEP_BRAIN_ENDPOINT=http://127.0.0.1:8788/deep \
npm run demo:browser
```

demo が提供するものです。

- `GET /events`: Server-Sent Events
- `POST /turn`: text / voice-like input
- `GET /state`: 現在の character state
- `GET /pjos`: Project OS state
- `GET /health`: readiness、brain slots、runtime/error metadata
- `GET /openapi.json`: ローカルHTTP API contract
- `GET /bodies`、`/body/:id`、`/body/:id/events`: MotionPNGTuber、M5Stack、
  Even G2、Live2D、VRM bridge state
- `POST /platform/discord/message`、`/platform/youtube/message`: platform testing
- `/?view=admin`: audience、platform identity、permission、stream session 管理

VS Code companion panel は次で開きます。

```bash
code examples/vscode-companion
```

詳細は [docs/vscode.md](./docs/vscode.md) です。

OBSやYouTube配信では overlay mode を使います。

```text
http://127.0.0.1:4178/?view=overlay
```

Overlay mode は操作UIを隠し、OBS Browser Source 合成用に transparent background を使います。
OBS WebSocket control は `createObsWebSocketAdapter` で扱います。
stream操作は `manage_stream` でgateされます。詳細は [docs/obs.md](./docs/obs.md) です。

## Core Concepts

### Character Instance

IroHarness における人格は、ただのpromptではありません。

```text
SOUL + memory + macro harness behavior + tools + body expression + failure modes
```

違う harness は違う人格として扱えます。例えば `Iroha-Hermes` と `Maguro-Codex` は
同じ世界観やチーム設定を共有できても、自動的に同一人物にはなりません。

### Bodies

body は device や renderer の adapter です。

- MotionPNGTuber
- Live2D
- VRM/3D
- M5Stack dot face
- Even G2 display
- browser avatar
- VS Code panel
- Slack / Discord text

すべてのbodyは、同じ normalized character state を受け取ります。
詳細は [docs/body-bridges.md](./docs/body-bridges.md) です。

### Project OS

PJOS は、macro decision と micro execution の間にある durable state layer です。
goals、stories、specs、tickets、runs、artifacts を記録し、どの人格と harness が
何を作ったのかを追えるようにします。

### Audience Registry And Permissions

同じ人が YouTube、Discord、Slack、browser に別IDで現れることがあります。
user registry はそれらを1人の user record にまとめます。

```js
userRegistry.registerUser({
  id: "user_keita",
  displayName: "Keita",
  role: "developer",
  identities: {
    youtube: "UCxxx",
    discord: "123456"
  }
});
```

role permissions によって、雑談だけできる人、深い設計議論ができる人、
micro harness に仕事を投げられる人を分けられます。
配信操作では OBS、scene、overlay、mute、live stream control が `stream` operation として
扱われ、`manage_stream` が必要になります。

## なぜRustを使うのか

Rust はリモートLLMの思考時間を短くするものではありません。
速くなる可能性があるのは、LLMを待っている周辺の処理です。

- audio stream routing
- VAD と interruption handling
- WebSocket fanout
- device state synchronization
- expression state updates
- low-latency scheduler loops

推奨する順番は次です。

```text
v0: Node.js core to stabilize protocols
v1: adapters for Codex, OpenClaw, Hermes, AIAvatarKit, M5Stack, Live2D
v2: Rust realtime core for audio/device/event bus
```

Rust core crate は `crates/realtime-core` にあります。
詳細は [docs/rust-core.md](./docs/rust-core.md) を見てください。

## Repository Layout

```text
src/
  index.js              core macro harness, router, PJOS, adapters
  adapters/             built-in adapter helpers
  testing/              contract testing helpers
fixtures/
  golden/               adapter contract fixtures
protocols/
  audience-store.schema.json
  character-state.schema.json
  realtime-core-command.schema.json
  realtime-core-message.schema.json
  sql/
    postgres-audience.sql
  user.schema.json
  adapter-contracts.md
docs/
  absorption-architecture.md
  adapter-contract-testing.md
  architecture.md
  audience-and-permissions.md
  audience-data-model.md
  brains.md
  body-bridges.md
  build-an-adapter.md
  capability-matrix.md
  cli.md
  codex.md
  ci.md
  design-principles.md
  external-bridges.md
  inspiration-map.md
  platform-adapters.md
  obs.md
  privacy-and-security.md
  streaming-community.md
  realtime.md
  rust-core.md
  vscode.md
  protocols.md
examples/
  adapter-skeleton.mjs
  audience-registry.mjs
  basic.mjs
  body-mappers.mjs
  brain-switching.mjs
  file-pjos.mjs
  codex-app-server.mjs
  discord-bot.mjs
  slack-events.mjs
  external-bridges.mjs
  youtube-live-poller.mjs
  obs-overlay-control.mjs
  realtime-core-process.mjs
  realtime-core-worker.mjs
  browser-server.mjs
  browser-avatar/
  vscode-companion/
test/
  *.test.js
```

## Roadmap

今後の予定は [ROADMAP.md](./ROADMAP.md) を見てください。

## License

MIT

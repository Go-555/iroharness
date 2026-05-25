import { createClaudeCodeCliMicroHarness } from "../src/adapters/index.js";

if (process.env.IROHARNESS_RUN_CLAUDE !== "1") {
  console.log(
    "Set IROHARNESS_RUN_CLAUDE=1 to run the real Claude Code CLI adapter."
  );
  process.exit(0);
}

const prompt = process.argv.slice(2).join(" ") || "このリポジトリの次の改善点を提案して";
const cwd = process.env.CLAUDE_WORKSPACE || process.cwd();
const command = process.env.CLAUDE_COMMAND || "claude";
const args = process.env.CLAUDE_ARGS
  ? process.env.CLAUDE_ARGS.split(" ").filter(Boolean)
  : ["-p"];

const claude = createClaudeCodeCliMicroHarness({
  command,
  args,
  cwd,
  timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS || 10 * 60_000)
});

const output = await claude.run(
  {
    id: "ticket_claude_demo",
    title: "Claude Code demo",
    purpose: prompt
  },
  {
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "The macro harness owns the character. Claude Code is delegated implementation."
    },
    actor: {
      user: {
        id: "developer",
        displayName: "Developer"
      },
      permissions: ["micro.delegate", "pjos.write"]
    },
    projectOs: {
      tickets: [
        {
          id: "ticket_claude_demo",
          status: "running",
          owner: "claude-code"
        }
      ]
    }
  }
);

console.log(JSON.stringify(output, null, 2));

// A command-hook fixture: reads the context JSON from stdin and emits a decision
// driven by ctx.input.text. Fixtures live under test/fixtures/ and are excluded
// from the test runner's glob (`test/*.test.js`), so they are never discovered
// as test files — only spawned by createCommandHook under test.
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const ctx = JSON.parse(raw);
  const text = ctx?.input?.text ?? "";
  if (text === "deny") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "fixture denied" }));
  } else if (text === "rewrite") {
    process.stdout.write(JSON.stringify({ decision: "allow", transform: { input: { ...ctx.input, text: "REWRITTEN" } } }));
  } else if (text === "null-transform") {
    process.stdout.write(JSON.stringify({ decision: "allow", transform: null }));
  } else if (text === "empty-transform") {
    process.stdout.write(JSON.stringify({ decision: "allow", transform: {} }));
  } else {
    process.stdout.write(JSON.stringify({ decision: "allow" }));
  }
});

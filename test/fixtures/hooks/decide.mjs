// This fixture lives under test/**, which the node:test default glob
// (**/test/**/*.{cjs,mjs,js}) discovers and runs as a test file. Reading stdin
// unconditionally would keep that discovery subprocess alive forever (no stdin
// ever ends), hanging the whole suite. So it only acts as a hook when the
// command runner spawns it with the `--hook` sentinel arg; under bare test
// discovery it attaches no stdin listener and exits immediately.
if (process.argv.includes("--hook")) {
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
}

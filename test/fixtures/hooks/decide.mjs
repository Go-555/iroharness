let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const ctx = JSON.parse(raw);
  const text = ctx?.input?.text ?? "";
  if (text === "deny") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "fixture denied" }));
  } else if (text === "rewrite") {
    process.stdout.write(JSON.stringify({ decision: "allow", transform: { input: { ...ctx.input, text: "REWRITTEN" } } }));
  } else {
    process.stdout.write(JSON.stringify({ decision: "allow" }));
  }
});

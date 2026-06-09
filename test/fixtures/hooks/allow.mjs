#!/usr/bin/env node
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ decision: "allow", transform: { marker: "ran" } }));
});

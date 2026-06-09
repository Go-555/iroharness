process.stdout.write(JSON.stringify({ decision: "allow", transform: { argv: process.argv.slice(2) } }));

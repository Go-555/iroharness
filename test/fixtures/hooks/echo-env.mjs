process.stdout.write(JSON.stringify({ decision: "allow", transform: { sawSecret: process.env.IROHA_SECRET ?? null, envKeys: Object.keys(process.env) } }));

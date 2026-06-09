process.stdout.write(
  JSON.stringify({
    decision: "allow",
    transform: {
      sawSecret: process.env.IROHA_SECRET ?? null,
      forwarded: process.env.HOOK_FORWARDED ?? null,
      envKeys: Object.keys(process.env),
    },
  }),
);

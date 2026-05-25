# CLI

The `iroharness` CLI creates a minimal app that keeps the character identity in
the macro harness and uses replaceable brains, devices, and micro harnesses.

## Init

```bash
npx iroharness init ./my-companion --character Iroha
cd my-companion
npm install
npm start
```

Generated files:

- `package.json`
- `src/app.mjs`
- `SOUL.md`
- `IDENTITY.md`
- `MEMORY.md`
- `.iroharness/`
- `.gitignore`
- `README.md`

Use `--force` only when you want to overwrite generated files.

`src/app.mjs` loads the character through `createFileCharacterProfile`, so the
generated markdown files are the local identity and memory source of truth.

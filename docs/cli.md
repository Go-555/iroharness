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
- `.iroharness/`
- `.gitignore`
- `README.md`

Use `--force` only when you want to overwrite generated files.

# Contributing

```bash
npm ci
npm run typecheck && npm test      # needs Node >= 22 for the tests (native TypeScript stripping)
npm run build && node scripts/smoke.mjs
```

## Reporting a wrong conversion

Open an issue with the old address, what you expected, and a link to the resolution or
official page that shows it. Wrong data usually originates upstream (see `NOTICE.md`); the
fix is a data pin update, not a code workaround.

## Updating the data

`data/units.json` and `data/legacy.json` are generated, never edited by hand.

1. Check out the two upstream repositories listed in `data/sources.json` at the new commits.
2. Update the commit hashes in `data/sources.json`, and `dataVersion` (resolution, effective date) if the legal basis changed.
3. Run `npm run data -- --units <units checkout> --mapping <mapping checkout>`.
   The script aborts if any count, code join or default-target invariant breaks.
4. Run `npm test` and review the diff of `data/`.

CI re-runs the build from the pinned commits and fails if the committed files differ.

## Release checklist

1. `npm run typecheck && npm test && npm run build && node scripts/smoke.mjs`
2. Update `CHANGELOG.md` and the version in `package.json`.
3. `npm publish` (the `prepublishOnly` script repeats the checks).
4. Tag `vX.Y.Z`.

## Demo GIF

`npm run build && node demo/capture.mjs && python3 -I demo/render.py` regenerates
`docs/demo.gif` from the real server's output.

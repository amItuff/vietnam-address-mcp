# Changelog

## Unreleased

- New tool `normalize_addresses` (up to 200 addresses per call, with a summary).
- New CLI mode `vietnam-address-mcp csv <file> --column <name>` for spreadsheets.
- Every result now carries `dataVersion` (`currentThrough`, `effectiveDate`), which is also in the server instructions.
- Weekly workflow that opens an issue when the pinned upstream data has moved.
- Dev toolchain: TypeScript 7.

## 0.1.0

First release.

- Tools: `normalize_address`, `convert_legacy_address`, `search_units`.
- Offline dataset: 34 provinces, 3,321 wards (current through Resolution 388/NQ-UBTVQH16),
  63 legacy provinces, 696 legacy districts, 10,040 legacy wards/island districts.
- Reproducible data build from two pinned MIT-licensed sources, with hard validation.

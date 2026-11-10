First release of vietnam-address-mcp: an MCP server that converts old Vietnamese addresses (63 provinces, 3 levels) to the new 34-province structure.

## Tools
- `normalize_address`: free-text address, old or new format, to the current structure
- `convert_legacy_address`: old province / district / ward fields to the new ward
- `search_units`: look up provinces and wards by name, current or legacy

## Highlights
- Offline, no API key. Data is bundled (34 provinces, 3,321 wards; 63 legacy provinces, 10,040 legacy units).
- Divided wards, ambiguous names and diacritic-only twins are reported explicitly instead of guessed.
- Data is rebuilt from two pinned MIT-licensed sources and verified in CI.

## Known limitations
- Old to new only.
- Default target for divided wards (471 of 10,040) is a heuristic.
- Names only, no street-level data.
- New-unit names current through Resolution 388/NQ-UBTVQH16.

See the README for install instructions and details.

Install: `npx -y vietnam-address-mcp`

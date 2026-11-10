import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalizeAddress, resolveLegacy } from './address.ts';
import { getDatabase } from './data.ts';
import { searchUnits } from './search.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false } as const;

function json(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function createServer(): McpServer {
  const db = getDatabase();
  const units = db.meta.sources['units'];
  const mapping = db.meta.sources['mapping'];

  const server = new McpServer(
    { name: 'vietnam-address-mcp', version: pkg.version },
    {
      instructions: [
        'Vietnamese administrative addresses after the 2025 reform: 34 provinces and 3,321 wards/communes, with no district level.',
        'Use these tools instead of guessing: ward names, merges and splits are easy to get wrong from memory.',
        'Always read `confidence` and `notes`. "split_default" means the old ward was divided between several new wards and the returned one is only a heuristic default; show `alternatives` to the user.',
        'A status of "ambiguous" means the input matches several units; ask the user (usually for the district) rather than choosing.',
        `Data: current names/codes from ${units?.repo} @ ${units?.commit.slice(0, 7)}; old→new mapping from ${mapping?.repo} @ ${mapping?.commit.slice(0, 7)} (both MIT).`,
        'Not covered: street-level data, coordinates, new→old conversion, wards merged before 2025 that are missing from the 2025-07 legacy list.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'normalize_address',
    {
      title: 'Normalize a Vietnamese address to the new administrative units',
      description:
        'Takes a free-text, comma-separated Vietnamese address in either the OLD format (ward, district, province - before 1 July 2025) ' +
        'or the NEW format (ward, province) and returns it in the current 2-level structure (34 provinces, no districts), ' +
        'keeping the street part. Handles missing diacritics, abbreviations (P., Q., TP.HCM) and a street glued to the ward. ' +
        'Chuẩn hóa địa chỉ / đổi địa chỉ cũ sang địa chỉ mới sau sáp nhập tỉnh, bỏ cấp huyện. ' +
        'Returns status ok | ambiguous | not_found, a confidence level, alternatives for divided wards, and suggestions for typos.',
      inputSchema: {
        address: z
          .string()
          .min(1)
          .max(500)
          .describe('Address with components separated by commas, e.g. "12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM".'),
      },
      annotations: { ...READ_ONLY, title: 'Normalize address' },
    },
    ({ address }) => json(normalizeAddress(address)),
  );

  server.registerTool(
    'convert_legacy_address',
    {
      title: 'Convert an old (pre-2025) ward/district/province to the new unit',
      description:
        'Converts a pre-July-2025 administrative address given as separate fields to the new 2-level structure. ' +
        'Prefer this over normalize_address when the parts are already split (e.g. database columns). ' +
        'Đổi xã/phường/huyện/tỉnh cũ sang đơn vị hành chính mới. ' +
        'If the old ward was divided between several new wards, the result has confidence "split_default" and lists every alternative. ' +
        'Omitting the district works when the ward name is unique in the province; otherwise the result is "ambiguous".',
      inputSchema: {
        province: z.string().min(1).max(100).describe('Old province, e.g. "Tỉnh Bình Dương" or "Hà Giang".'),
        district: z.string().max(100).optional().describe('Old district, e.g. "Quận 1" or "Huyện Kỳ Anh". Optional but recommended.'),
        ward: z
          .string()
          .max(100)
          .optional()
          .describe('Old ward/commune, e.g. "Phường Bến Nghé". Omit only for the five island districts (e.g. Côn Đảo).'),
        street: z.string().max(200).optional().describe('Street/house number, returned unchanged inside the formatted address.'),
      },
      annotations: { ...READ_ONLY, title: 'Convert legacy address' },
    },
    ({ province, district, ward, street }) => json(resolveLegacy({ province, district, ward }, street?.trim() || null)),
  );

  server.registerTool(
    'search_units',
    {
      title: 'Look up provinces and wards by name',
      description:
        'Searches administrative units by name, ignoring diacritics and tolerating small typos. ' +
        'scope "current" (default) searches the 34 provinces and 3,321 wards in force today and returns official codes. ' +
        'scope "legacy" searches pre-2025 provinces, districts and wards and returns where each one maps to now. ' +
        'Tra cứu tỉnh/thành, phường/xã theo tên, kèm mã đơn vị hành chính.',
      inputSchema: {
        query: z.string().min(1).max(100).describe('Name or part of a name, e.g. "bến nghé", "thu duc", "Sa Pa".'),
        level: z.enum(['any', 'province', 'district', 'ward']).default('any').describe('"district" exists only in legacy scope.'),
        scope: z.enum(['current', 'legacy']).default('current'),
        province: z.string().max(100).optional().describe('Restrict to one province (name or 2-digit code).'),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { ...READ_ONLY, title: 'Search units' },
    },
    ({ query, level, scope, province, limit }) => {
      const results = searchUnits({ query, level, scope, limit, ...(province ? { province } : {}) });
      return json({ count: results.length, results });
    },
  );

  return server;
}

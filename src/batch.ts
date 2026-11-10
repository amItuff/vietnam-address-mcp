import { normalizeAddress, type Resolution } from './address.ts';
import { formatCsv, parseCsv } from './csv.ts';

export interface BatchItem {
  index: number;
  input: string;
  result: Resolution;
}
export interface BatchResult {
  total: number;
  summary: { ok: number; ambiguous: number; not_found: number; splitDefault: number };
  items: BatchItem[];
}

export function normalizeMany(addresses: string[]): BatchResult {
  const items = addresses.map((input, index) => ({ index, input, result: normalizeAddress(input) }));
  return {
    total: items.length,
    summary: {
      ok: items.filter((i) => i.result.status === 'ok').length,
      ambiguous: items.filter((i) => i.result.status === 'ambiguous').length,
      not_found: items.filter((i) => i.result.status === 'not_found').length,
      splitDefault: items.filter((i) => i.result.confidence === 'split_default').length,
    },
    items,
  };
}

const OUTPUT_COLUMNS = ['new_address', 'address_status', 'address_confidence', 'address_note'];

/**
 * Adds the converted address to every row of a CSV file. The original columns are kept untouched.
 * Rows that are not resolved keep an empty new_address so they are easy to filter and review.
 */
export function convertCsv(
  text: string,
  options: { column: string; delimiter?: string },
): { csv: string; summary: BatchResult['summary']; total: number } {
  const { rows, delimiter } = parseCsv(text, options.delimiter);
  const [header, ...body] = rows;
  if (!header) throw new Error('The CSV file is empty');
  const col = header.findIndex((h) => h.trim().toLowerCase() === options.column.trim().toLowerCase());
  if (col < 0) throw new Error(`Column "${options.column}" not found. Columns: ${header.join(', ')}`);
  const clash = OUTPUT_COLUMNS.filter((c) => header.includes(c));
  if (clash.length) throw new Error(`Input already has column(s) ${clash.join(', ')}; rename them first`);

  const batch = normalizeMany(body.map((r) => r[col] ?? ''));
  const out = [[...header, ...OUTPUT_COLUMNS]];
  body.forEach((r, i) => {
    const res = (batch.items[i] as BatchItem).result;
    const note = res.status === 'ok' ? (res.confidence === 'split_default' ? 'Divided ward: default chosen, check alternatives' : '') : res.summary;
    const padded = [...r, ...Array(Math.max(0, header.length - r.length)).fill('')];
    out.push([...padded, res.address?.formattedWithStreet ?? '', res.status, res.confidence ?? '', note]);
  });
  return { csv: formatCsv(out, delimiter), summary: batch.summary, total: batch.total };
}

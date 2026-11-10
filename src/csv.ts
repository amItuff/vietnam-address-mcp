/** Minimal RFC 4180 CSV reader/writer (quoted fields, escaped quotes, embedded newlines, BOM, CRLF). */

export function detectDelimiter(headerLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, headerLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return (counts[0] as readonly [string, number])[1] > 0 ? (counts[0] as readonly [string, number])[0] : ',';
}

export function parseCsv(text: string, delimiter?: string): { rows: string[][]; delimiter: string } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = delimiter ?? detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error('Unterminated quoted field in CSV input');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((f) => f.trim() !== '')), delimiter: delim };
}

export function formatCsv(rows: string[][], delimiter = ','): string {
  const cell = (f: string) => (f.includes(delimiter) || /["\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
  return rows.map((r) => r.map(cell).join(delimiter)).join('\n') + '\n';
}

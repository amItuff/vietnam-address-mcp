/**
 * Text normalisation for Vietnamese place names.
 *
 * Matching is done on "keys": lower-case, diacritic-free, punctuation-free names with the
 * administrative type (Phường, Xã, Quận, ...) removed. This makes "Hoà" and "Hòa" equal
 * (tone-mark placement differs between sources) and lets users omit accents.
 */

export type Kind = 'province' | 'district' | 'ward';

const TYPE_PREFIXES: Record<Kind, readonly (readonly string[])[]> = {
  province: [['tinh'], ['thanh', 'pho']],
  district: [['quan'], ['huyen'], ['thi', 'xa'], ['thanh', 'pho']],
  ward: [['phuong'], ['xa'], ['dac', 'khu'], ['thi', 'tran']],
};

/** Common abbreviations written as a single token, expanded before type detection. */
const ABBREVIATIONS: Record<string, readonly string[]> = {
  p: ['phuong'],
  q: ['quan'],
  x: ['xa'],
  h: ['huyen'],
  tt: ['thi', 'tran'],
  tx: ['thi', 'xa'],
  tp: ['thanh', 'pho'],
};

/** Lower-case, strip diacritics (đ → d), turn punctuation into spaces, collapse whitespace. */
export function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TONES = '\u0300\u0301\u0309\u0303\u0323';

/**
 * Lower-cases and tidies a name but KEEPS diacritics, so that distinct wards such as
 * "Sa Pa" / "Sa Pả" or "Văn Lang" / "Văn Lăng" stay distinct. The tone mark on the open
 * syllables oa/oe/uy is moved to one canonical spot ("hoà" and "hòa" are the same word).
 */
export function precise(input: string): string {
  return input
    .normalize('NFD')
    .replace(new RegExp(`([oO])([aAeE])([${TONES}])(?![A-Za-z\\u0300-\\u036f])`, 'g'), '$1$3$2')
    .replace(new RegExp(`([uU])([yY])([${TONES}])(?![A-Za-z\\u0300-\\u036f])`, 'g'), '$1$3$2')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .normalize('NFC');
}

/** True if the text carries any Vietnamese diacritic (including đ). */
export function hasDiacritics(text: string): boolean {
  return /[\u0300-\u036f]|[đĐ]/.test(text.normalize('NFD'));
}

/** One word of a name in both spellings: with diacritics (p) and without (f). */
interface Tok {
  p: string;
  f: string;
}

function tokens(input: string): Tok[] {
  const out: Tok[] = [];
  const raw = precise(input).split(' ').filter(Boolean).map((p) => ({ p, f: fold(p) }));
  const num = (t: Tok): Tok => (/^\d+$/.test(t.f) ? { p: String(Number(t.f)), f: String(Number(t.f)) } : t);
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as Tok;
    // "p5", "q10" → "phuong 5", "quan 10"
    const m = /^([pqx]|tt|tx|tp)(\d+)$/.exec(t.f);
    if (m) {
      for (const w of ABBREVIATIONS[m[1] as string] as readonly string[]) out.push({ p: w, f: w });
      out.push(num({ p: m[2] as string, f: m[2] as string }));
      continue;
    }
    // Bare abbreviation ("P.", "Q.", "TP") directly before a name or number
    const abbr = ABBREVIATIONS[t.f];
    if (abbr && i < raw.length - 1) {
      for (const w of abbr) out.push({ p: w, f: w });
      continue;
    }
    out.push(num(t));
  }
  return out;
}

const join = (ts: Tok[]) => ({ p: ts.map((t) => t.p).join(' '), f: ts.map((t) => t.f).join(' ') });

export interface Variant {
  /** With diacritics (tone placement canonicalised). */
  p: string;
  /** Without diacritics. */
  f: string;
}

export interface ParsedName {
  /** Candidate lookup variants, most specific first. */
  variants: Variant[];
  /** Diacritic-free keys of the variants, most specific first. */
  keys: string[];
  /** The name with any leading type word removed, e.g. "ben nghe" for "Phường Bến Nghé". */
  bare: string;
  /** Type token(s) the user wrote, if recognised, e.g. "phuong". */
  type: string | null;
}

/**
 * Turns a user-written name into lookup variants.
 * The as-written variant is tried first, so a real name that starts with a type word
 * (e.g. "Huyện Quan Hóa") is not mangled; the type-stripped variant follows.
 * Compact variants (no spaces) rescue inputs like "hochiminh".
 */
export function parseName(input: string, kind: Kind): ParsedName {
  const toks = tokens(input);
  let type: string | null = null;
  let stripped = toks;
  for (const prefix of TYPE_PREFIXES[kind]) {
    if (toks.length > prefix.length && prefix.every((p, i) => toks[i]?.f === p)) {
      type = prefix.join(' ');
      stripped = toks.slice(prefix.length);
      break;
    }
  }
  const asWritten = join(toks);
  const bare = join(stripped);
  const variants: Variant[] = [asWritten];
  if (bare.f !== asWritten.f || bare.p !== asWritten.p) variants.push(bare);
  for (const v of [...variants]) {
    const c = { p: v.p.replace(/ /g, ''), f: v.f.replace(/ /g, '') };
    if (c.p !== v.p) variants.push(c);
  }
  return { variants, keys: [...new Set(variants.map((v) => v.f))], bare: bare.f, type };
}

/** Keys under which a canonical (data) name is indexed: type already removed. */
export function indexKeys(name: string): Variant[] {
  const v = join(tokens(name));
  const c = { p: v.p.replace(/ /g, ''), f: v.f.replace(/ /g, '') };
  return c.p === v.p ? [v] : [v, c];
}

/** Diacritic-free key of a data name, used for ranking in search. */
export function indexKey(name: string): string {
  return join(tokens(name)).f;
}

export function compactKey(key: string): string {
  return key.replace(/ /g, '');
}

/** Levenshtein distance with an early-exit cap. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length] as number;
}

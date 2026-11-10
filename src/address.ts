import { getDatabase, type LegacyDistrict, type LegacyWard, type Province, type Ward } from './data.ts';
import { fold, hasDiacritics } from './text.ts';
import { lookup } from './lookup.ts';
import { searchUnits } from './search.ts';

export type Confidence =
  /** Every level matched uniquely and the legacy→current mapping is one-to-one or many-to-one. */
  | 'exact'
  /** The legacy ward was divided between several current wards; a default was chosen. */
  | 'split_default'
  /** A level was missing (e.g. no district) but the remaining parts identify a single unit. */
  | 'inferred';

export interface UnitRef {
  code: string;
  fullName: string;
}
export interface AddressOption {
  ward: UnitRef;
  province: UnitRef;
  formatted: string;
}
export interface LegacyRef {
  province: UnitRef;
  district?: UnitRef;
  ward?: UnitRef;
  formatted: string;
}
export interface Candidate {
  from: LegacyRef | null;
  to: AddressOption;
  split: boolean;
}
export interface Resolution {
  status: 'ok' | 'ambiguous' | 'not_found';
  inputFormat: 'legacy' | 'current' | null;
  confidence?: Confidence;
  summary: string;
  street: string | null;
  address?: AddressOption & { formattedWithStreet: string };
  from?: LegacyRef;
  /** Other current wards a divided legacy ward also covers. */
  alternatives?: AddressOption[];
  candidates?: Candidate[];
  didYouMean?: string[];
  notes: string[];
}

const COUNTRY = new Set(['viet nam', 'vietnam', 'vn', 'vnm']);

export function splitAddress(text: string): string[] {
  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  while (parts.length > 1 && COUNTRY.has(fold(parts[parts.length - 1] as string))) parts.pop();
  return parts;
}

/** Explains the common cause of ambiguity: names that differ only by diacritics. */
function diacriticNote(names: string[]): string[] {
  return new Set(names.map((n) => fold(n))).size === 1 && new Set(names).size > 1
    ? ['These names differ only by diacritics. Write the address with full diacritics to disambiguate.']
    : [];
}

const ref = (u: { code: string; fullName: string }): UnitRef => ({ code: u.code, fullName: u.fullName });

function option(ward: Ward): AddressOption {
  const db = getDatabase();
  const province = db.provinceByCode.get(ward.provinceCode) as Province;
  return { ward: ref(ward), province: ref(province), formatted: `${ward.fullName}, ${province.fullName}` };
}

function legacyRef(w: LegacyWard | null, d: LegacyDistrict | null, pCode: string): LegacyRef {
  const db = getDatabase();
  const p = db.legacyProvinceByCode.get(pCode) as Province;
  const district = d ?? (w ? db.legacyDistrictByKey.get(`${w.provinceCode}/${w.districtCode}`) : undefined);
  const path = [w?.fullName, district?.fullName, p.fullName].filter(Boolean).join(', ');
  return {
    province: ref(p),
    ...(district ? { district: ref(district) } : {}),
    ...(w ? { ward: ref(w) } : {}),
    formatted: path,
  };
}

function withStreet(opt: AddressOption, street: string | null) {
  return { ...opt, formattedWithStreet: [street, opt.formatted].filter(Boolean).join(', ') };
}

function notFound(summary: string, street: string | null, notes: string[], didYouMean?: string[]): Resolution {
  return { status: 'not_found', inputFormat: null, summary, street, notes, ...(didYouMean?.length ? { didYouMean } : {}) };
}

/** Minimum search score worth showing as a suggestion (edit distance 1 or better). */
const MIN_SUGGESTION_SCORE = 150;

function suggestions(texts: (string | undefined)[], provinceText: string | undefined): string[] {
  const db = getDatabase();
  const scored = new Map<string, number>();
  const note = (path: string, scope: 'current' | 'legacy', score: number) => {
    const label = scope === 'legacy' ? `${path} (old, pre-2025)` : path;
    scored.set(label, Math.max(scored.get(label) ?? 0, score));
  };
  for (const scope of ['current', 'legacy'] as const) {
    const index = scope === 'current' ? db.provinceIndex : db.legacyProvinceIndex;
    const provinceKnown = provinceText ? lookup<Province>(index, provinceText, 'province', hasDiacritics(provinceText)).items.length > 0 : false;
    if (provinceText && !provinceKnown) {
      // The province itself is the likely typo; do not "correct" a ward across the country.
      for (const h of searchUnits({ query: provinceText, level: 'province', scope, limit: 2 })) {
        if (h.score >= MIN_SUGGESTION_SCORE) note(h.path, scope, h.score);
      }
      continue;
    }
    for (const text of texts) {
      if (!text) continue;
      const hits = searchUnits({
        query: text, level: 'ward', scope, limit: 3,
        ...(provinceText ? { province: provinceText } : {}),
      });
      for (const h of hits) if (h.score >= MIN_SUGGESTION_SCORE) note(h.path, scope, h.score);
    }
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 5);
}

export interface LegacyInput {
  province: string;
  district?: string | undefined;
  ward?: string | undefined;
}

/** Converts a legacy (pre-July-2025, 3-level) address to the current 2-level structure. */
export function resolveLegacy(input: LegacyInput, street: string | null = null): Resolution {
  const db = getDatabase();
  const notes: string[] = [];
  const acc = hasDiacritics([input.province, input.district, input.ward, street].filter(Boolean).join(' '));
  const provinces = lookup<Province>(db.legacyProvinceIndex, input.province, 'province', acc).items;
  if (!provinces.length) {
    return notFound(`Province "${input.province}" is not a recognised pre-2025 province.`, street, notes, suggestions([], input.province));
  }

  const matches: { ward: LegacyWard; district: LegacyDistrict }[] = [];
  const islands: LegacyDistrict[] = [];
  let districtMissing = false;

  for (const p of provinces) {
    let districts: LegacyDistrict[] | null = null;
    if (input.district) {
      districts = lookup<LegacyDistrict>(db.legacyDistrictsByProvince.get(p.code), input.district, 'district', acc).items;
      if (!districts.length) continue;
    }
    if (input.ward === undefined) {
      for (const d of districts ?? []) if (d.target) islands.push(d);
      continue;
    }
    if (districts) {
      for (const d of districts) {
        for (const w of lookup<LegacyWard>(db.legacyWardsByDistrict.get(`${d.provinceCode}/${d.code}`), input.ward, 'ward', acc).items) {
          matches.push({ ward: w, district: d });
        }
      }
    } else {
      districtMissing = true;
      for (const w of lookup<LegacyWard>(db.legacyWardsByProvince.get(p.code), input.ward, 'ward', acc).items) {
        const d = db.legacyDistrictByKey.get(`${w.provinceCode}/${w.districtCode}`) as LegacyDistrict;
        matches.push({ ward: w, district: d });
      }
    }
  }

  if (islands.length === 1) {
    const d = islands[0] as LegacyDistrict;
    const target = db.wardByCode.get(d.target as string) as Ward;
    const opt = option(target);
    return {
      status: 'ok', inputFormat: 'legacy', confidence: 'exact', street,
      summary: `${legacyRef(null, d, d.provinceCode).formatted} → ${opt.formatted}`,
      address: withStreet(opt, street), from: legacyRef(null, d, d.provinceCode),
      notes: ['Island district: the whole district became one special zone (Đặc khu).'],
    };
  }
  if (!matches.length) {
    const what = input.ward === undefined ? `district "${input.district}"` : `ward "${input.ward}"`;
    return notFound(
      `No pre-2025 ${what} found in "${input.province}".`, street, notes,
      suggestions([input.ward ?? input.district], input.province),
    );
  }

  if (matches.length > 1) {
    const candidates: Candidate[] = matches.slice(0, 10).map(({ ward, district }) => ({
      from: legacyRef(ward, district, ward.provinceCode),
      to: option(db.wardByCode.get(ward.defaultTarget) as Ward),
      split: ward.split,
    }));
    return {
      status: 'ambiguous', inputFormat: 'legacy', street, candidates,
      summary: `"${input.ward}" matches ${matches.length} legacy wards; specify the district${districtMissing ? '' : ' type (e.g. Huyện vs Thị xã)'}.`,
      notes: [
        districtMissing ? 'No district was given, so the ward name is not unique in this province.' : 'The district name is shared by several districts of the province.',
        ...diacriticNote(matches.map((m) => m.ward.name)),
      ],
    };
  }

  const { ward, district } = matches[0] as { ward: LegacyWard; district: LegacyDistrict };
  const from = legacyRef(ward, district, ward.provinceCode);
  const def = option(db.wardByCode.get(ward.defaultTarget) as Ward);
  const alternatives = ward.targets.filter((t) => t !== ward.defaultTarget).map((t) => option(db.wardByCode.get(t) as Ward));
  const confidence: Confidence = ward.split ? 'split_default' : districtMissing ? 'inferred' : 'exact';
  if (ward.split) {
    notes.push(
      `${ward.fullName} was divided between ${ward.targets.length} current wards. ` +
        "The default is only a heuristic (the upstream dataset picks the new ward that contains, or is nearest to, the old ward's centre point). " +
        'Use the street to confirm, or check the alternatives.',
    );
  }
  if (districtMissing && !ward.split) notes.push('No district was given; the ward name is unique in the province, so it was inferred.');
  return {
    status: 'ok', inputFormat: 'legacy', confidence, street,
    summary: `${from.formatted} → ${def.formatted}`,
    address: withStreet(def, street), from,
    ...(alternatives.length ? { alternatives } : {}),
    notes,
  };
}

/** Validates/canonicalises an address that is already in the current 2-level structure. */
export function resolveCurrent(input: { province: string; ward: string }, street: string | null = null): Resolution {
  const db = getDatabase();
  const acc = hasDiacritics([input.province, input.ward, street].filter(Boolean).join(' '));
  const provinces = lookup<Province>(db.provinceIndex, input.province, 'province', acc).items;
  if (!provinces.length) return notFound(`Province "${input.province}" is not one of the 34 current provinces.`, street, [], suggestions([], input.province));
  const found: Ward[] = [];
  let userType: string | null = null;
  for (const p of provinces) {
    const r = lookup<Ward>(db.wardsByProvince.get(p.code), input.ward, 'ward', acc);
    userType = r.userType;
    found.push(...r.items);
  }
  if (!found.length) {
    return notFound(`No current ward "${input.ward}" in "${provinces[0]?.fullName}".`, street, [], suggestions([input.ward], input.province));
  }
  if (found.length > 1) {
    return {
      status: 'ambiguous', inputFormat: 'current', street,
      candidates: found.slice(0, 10).map((w) => ({ from: null, to: option(w), split: false })),
      summary: `"${input.ward}" matches ${found.length} current wards.`, notes: diacriticNote(found.map((w) => w.name)),
    };
  }
  const w = found[0] as Ward;
  const opt = option(w);
  const notes: string[] = [];
  if (userType && userType !== fold(w.type)) {
    notes.push(`The unit type changed: "${input.ward}" is now "${w.fullName}".`);
  }
  return {
    status: 'ok', inputFormat: 'current', confidence: 'exact', street,
    summary: opt.formatted, address: withStreet(opt, street), notes,
  };
}

const WARD_WORDS = new Set(['phuong', 'xa', 'p']);

/**
 * Splits "12 Lê Lợi phường Bến Nghé" into ["12 Lê Lợi", "phường Bến Nghé"] at the last
 * ward-type word. Used only as a retry, after the comma-separated reading failed.
 */
export function splitLeadingStreet(part: string): [string, string] | null {
  const words = part.split(' ');
  for (let i = words.length - 2; i >= 1; i--) {
    const w = fold(words[i] as string);
    const pair = `${w} ${fold(words[i + 1] as string)}`;
    if (WARD_WORDS.has(w) || pair === 'thi tran' || pair === 'dac khu') {
      return [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    }
  }
  return null;
}

type Stage = 'legacy3' | 'other';

/**
 * Tries the interpretations of one comma-split address.
 *  - legacy3: old format with all of ward, district, province.
 *  - other:   already-current format, old island district, old format with district omitted.
 */
function attempt(parts: string[], stage: Stage): Resolution | null {
  const db = getDatabase();
  const acc = hasDiacritics(parts.join(' '));
  const n = parts.length;
  const at = (i: number) => parts[n + i] as string;
  const streetBefore = (count: number) => (n - count > 0 ? parts.slice(0, n - count).join(', ') : null);
  const usable = (r: Resolution) => r.status === 'ok' || r.status === 'ambiguous';

  if (stage === 'legacy3') {
    if (n < 3) return null;
    const a = resolveLegacy({ province: at(-1), district: at(-2), ward: at(-3) }, streetBefore(3));
    return usable(a) ? a : null;
  }
  if (n < 2) return null;
  const c = resolveCurrent({ province: at(-1), ward: at(-2) }, streetBefore(2));
  if (usable(c)) {
    // "Thủ Đức" is both a current ward and a former city/district: say so instead of guessing silently.
    const legacyProvinces = lookup<Province>(db.legacyProvinceIndex, at(-1), 'province', acc).items;
    for (const p of legacyProvinces) {
      if (lookup<LegacyDistrict>(db.legacyDistrictsByProvince.get(p.code), at(-2), 'district', acc).items.length) {
        c.notes.push(
          `"${at(-2)}" is also the name of a pre-2025 district. It was read as a current ward; ` +
            'if the address is old-format, include the ward (e.g. "Phường X, ' + at(-2) + ', ...").',
        );
        break;
      }
    }
    return c;
  }
  if (lookup<Province>(db.legacyProvinceIndex, at(-1), 'province', acc).items.length > 0) {
    // Old island district (no ward level)
    const b = resolveLegacy({ province: at(-1), district: at(-2) }, streetBefore(2));
    if (usable(b)) return b;
    // Old format with the district omitted
    const d = resolveLegacy({ province: at(-1), ward: at(-2) }, streetBefore(2));
    if (usable(d)) return d;
  }
  return null;
}

/** Parses a free-text, comma-separated Vietnamese address (old or new format). */
export function normalizeAddress(text: string): Resolution {
  const parts = splitAddress(text);
  const n = parts.length;
  if (n < 2) {
    return notFound('Need at least a ward and a province, separated by commas.', null, [
      'Example: "12 Lê Lợi, Phường Bến Nghé, Quận 1, TP Hồ Chí Minh".',
    ]);
  }
  // The street may be glued to the ward ("12 Lê Lợi phường Bến Nghé, Quận 1, HCM"), so each
  // interpretation is also tried with that part split. Old-format (3 levels) is tried first
  // because it needs the most evidence; a bare "Thủ Đức" must not beat "…phường Linh Trung, Thủ Đức".
  const withSplit = (offset: number): string[] | null => {
    const idx = n - offset;
    const split = idx >= 0 ? splitLeadingStreet(parts[idx] as string) : null;
    return split ? [...parts.slice(0, idx), split[0], split[1], ...parts.slice(idx + 1)] : null;
  };
  const split3 = withSplit(3);
  const split2 = withSplit(2);
  const r =
    attempt(parts, 'legacy3') ??
    (split3 ? attempt(split3, 'legacy3') : null) ??
    attempt(parts, 'other') ??
    (split2 ? attempt(split2, 'other') : null);
  if (r) return r;

  return notFound(
    'Could not match this address to a known old or new administrative unit.',
    null,
    ['Check spelling, or pass the parts separately to convert_legacy_address.'],
    suggestions([parts[n - 2], n >= 3 ? parts[n - 3] : undefined], parts[n - 1]),
  );
}

import { getDatabase, type Province } from './data.ts';
import { compactKey, editDistance, hasDiacritics, indexKey, parseName } from './text.ts';
import { lookup } from './lookup.ts';

export type Level = 'province' | 'district' | 'ward' | 'any';
export type Scope = 'current' | 'legacy';

export interface SearchHit {
  scope: Scope;
  level: 'province' | 'district' | 'ward';
  code: string;
  fullName: string;
  /** Full path, e.g. "Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh". */
  path: string;
  /** For legacy wards/districts: where they map to today. */
  now?: { code: string; fullName: string; path: string; isDefault: boolean }[];
  score: number;
}

export interface SearchOptions {
  query: string;
  level?: Level;
  scope?: Scope;
  /** Restrict to a province, given by name (any spelling) or code. */
  province?: string;
  limit?: number;
}

function score(query: string, compactQuery: string, name: string): number {
  const key = indexKey(name);
  if (key === query) return 1000;
  if (key.startsWith(query + ' ') || key.startsWith(query)) return 800 - Math.min(key.length - query.length, 50);
  if (` ${key} `.includes(` ${query} `)) return 600;
  if (key.includes(query)) return 400;
  const ck = compactKey(key);
  if (ck.includes(compactQuery)) return 300;
  if (query.length >= 4) {
    const d = editDistance(query, key, 2);
    if (d <= 2) return 200 - d * 40;
    for (const tok of key.split(' ')) {
      if (tok.length >= 4 && editDistance(query, tok, 1) <= 1) return 120;
    }
  }
  return 0;
}

function findProvinceCodes(raw: string, scope: Scope): Set<string> {
  const db = getDatabase();
  const codes = new Set<string>();
  const trimmed = raw.trim();
  const map = scope === 'current' ? db.provinceByCode : db.legacyProvinceByCode;
  if (map.has(trimmed.padStart(2, '0')) && /^\d{1,2}$/.test(trimmed)) codes.add(trimmed.padStart(2, '0'));
  const index = scope === 'current' ? db.provinceIndex : db.legacyProvinceIndex;
  for (const p of lookup<Province>(index, trimmed, 'province', hasDiacritics(trimmed)).items) codes.add(p.code);
  return codes;
}

/** Searches provinces and wards (and, for scope "legacy", districts) by name. */
export function searchUnits(opts: SearchOptions): SearchHit[] {
  const db = getDatabase();
  const scope = opts.scope ?? 'current';
  const level = opts.level ?? 'any';
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  // Strip a leading type word so "phuong ben nghe" finds "Bến Nghé"
  const query = parseName(opts.query, 'ward').bare.trim();
  if (!query) return [];
  const cq = compactKey(query);
  const only = opts.province ? findProvinceCodes(opts.province, scope) : undefined;
  if (opts.province && only?.size === 0) return [];

  const hits: SearchHit[] = [];
  const pName = (code: string) => (scope === 'current' ? db.provinceByCode : db.legacyProvinceByCode).get(code)?.fullName ?? '';

  if (level === 'any' || level === 'province') {
    for (const p of scope === 'current' ? db.provinces : db.legacyProvinces) {
      if (only && !only.has(p.code)) continue;
      const s = score(query, cq, p.name);
      if (s > 0) hits.push({ scope, level: 'province', code: p.code, fullName: p.fullName, path: p.fullName, score: s });
    }
  }
  if (scope === 'legacy' && (level === 'any' || level === 'district')) {
    for (const d of db.legacyDistricts) {
      if (only && !only.has(d.provinceCode)) continue;
      const s = score(query, cq, d.name);
      if (s > 0) {
        const target = d.target ? db.wardByCode.get(d.target) : undefined;
        hits.push({
          scope, level: 'district', code: `${d.provinceCode}/${d.code}`, fullName: d.fullName,
          path: `${d.fullName}, ${pName(d.provinceCode)}`, score: s,
          ...(target ? { now: [{ code: target.code, fullName: target.fullName, path: `${target.fullName}, ${db.provinceByCode.get(target.provinceCode)?.fullName}`, isDefault: true }] } : {}),
        });
      }
    }
  }
  if (level === 'any' || level === 'ward') {
    if (scope === 'current') {
      for (const w of db.wards) {
        if (only && !only.has(w.provinceCode)) continue;
        const s = score(query, cq, w.name);
        if (s > 0) hits.push({ scope, level: 'ward', code: w.code, fullName: w.fullName, path: `${w.fullName}, ${pName(w.provinceCode)}`, score: s });
      }
    } else {
      for (const w of db.legacyWards) {
        if (only && !only.has(w.provinceCode)) continue;
        const s = score(query, cq, w.name);
        if (s <= 0) continue;
        const district = db.legacyDistrictByKey.get(`${w.provinceCode}/${w.districtCode}`);
        hits.push({
          scope, level: 'ward', code: w.code, fullName: w.fullName,
          path: `${w.fullName}, ${district?.fullName}, ${pName(w.provinceCode)}`, score: s,
          now: w.targets.map((t) => {
            const tw = db.wardByCode.get(t);
            return { code: t, fullName: tw?.fullName ?? t, path: `${tw?.fullName}, ${db.provinceByCode.get(tw?.provinceCode ?? '')?.fullName}`, isDefault: t === w.defaultTarget };
          }),
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'vi'));
  return hits.slice(0, limit);
}

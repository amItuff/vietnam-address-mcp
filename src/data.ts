import { readFileSync } from 'node:fs';
import { indexKeys } from './text.ts';

export interface Province {
  code: string;
  type: string;
  name: string;
  fullName: string;
}
export interface Ward extends Province {
  provinceCode: string;
}
export interface LegacyDistrict {
  code: string;
  provinceCode: string;
  type: string;
  name: string;
  fullName: string;
  /** Set only for the five island districts that became a single special zone. */
  target?: string;
}
export interface LegacyWard extends Ward {
  districtCode: string;
  /** Current ward codes this legacy ward maps to (more than one if it was divided). */
  targets: string[];
  defaultTarget: string;
  split: boolean;
}

type Index<T> = Map<string, T[]>;

function add<T>(index: Index<T>, name: string, item: T): void {
  for (const v of indexKeys(name)) {
    for (const key of new Set([`p:${v.p}`, `f:${v.f}`])) {
      const list = index.get(key);
      if (list) {
        if (!list.includes(item)) list.push(item);
      } else index.set(key, [item]);
    }
  }
}

function load<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8')) as T;
}

/**
 * Province nicknames used in real addresses. Both sides are index keys (see indexKey).
 * Only unambiguous forms are listed ("dn" would be Đà Nẵng or Đồng Nai, so it is not).
 */
const PROVINCE_ALIASES: Record<string, string> = {
  hcm: 'ho chi minh',
  tphcm: 'ho chi minh',
  'sai gon': 'ho chi minh',
  saigon: 'ho chi minh',
  hn: 'ha noi',
  brvt: 'ba ria vung tau',
  'thua thien hue': 'hue',
};

export interface Database {
  meta: {
    dataVersion: { currentThrough: string; effectiveDate: string; legacyBaseline: string };
    sources: Record<string, { repo: string; commit: string; license: string }>;
  };
  provinces: Province[];
  wards: Ward[];
  provinceByCode: Map<string, Province>;
  wardByCode: Map<string, Ward>;
  provinceIndex: Index<Province>;
  wardsByProvince: Map<string, Index<Ward>>;
  legacyProvinces: Province[];
  legacyDistricts: LegacyDistrict[];
  legacyWards: LegacyWard[];
  legacyProvinceByCode: Map<string, Province>;
  legacyProvinceIndex: Index<Province>;
  legacyDistrictsByProvince: Map<string, Index<LegacyDistrict>>;
  legacyDistrictByKey: Map<string, LegacyDistrict>;
  legacyWardsByDistrict: Map<string, Index<LegacyWard>>;
  legacyWardsByProvince: Map<string, Index<LegacyWard>>;
}

function sub<T>(map: Map<string, Index<T>>, key: string): Index<T> {
  let m = map.get(key);
  if (!m) map.set(key, (m = new Map()));
  return m;
}

export function buildDatabase(): Database {
  const units = load<{ meta: Database['meta']; provinces: Province[]; wards: Ward[] }>('units.json');
  const legacy = load<{
    provinces: Province[];
    districts: LegacyDistrict[];
    wards: LegacyWard[];
  }>('legacy.json');

  const provinceIndex: Index<Province> = new Map();
  const legacyProvinceIndex: Index<Province> = new Map();
  const wardsByProvince = new Map<string, Index<Ward>>();
  const legacyDistrictsByProvince = new Map<string, Index<LegacyDistrict>>();
  const legacyWardsByDistrict = new Map<string, Index<LegacyWard>>();
  const legacyWardsByProvince = new Map<string, Index<LegacyWard>>();

  for (const p of units.provinces) add(provinceIndex, p.name, p);
  for (const p of legacy.provinces) add(legacyProvinceIndex, p.name, p);
  for (const [alias, target] of Object.entries(PROVINCE_ALIASES)) {
    for (const [idx, list] of [
      [provinceIndex, units.provinces],
      [legacyProvinceIndex, legacy.provinces],
    ] as const) {
      for (const p of list) if (indexKeys(p.name).some((v) => v.f === target)) add(idx, alias, p);
    }
  }
  for (const w of units.wards) add(sub(wardsByProvince, w.provinceCode), w.name, w);
  for (const d of legacy.districts) add(sub(legacyDistrictsByProvince, d.provinceCode), d.name, d);
  for (const w of legacy.wards) {
    add(sub(legacyWardsByDistrict, `${w.provinceCode}/${w.districtCode}`), w.name, w);
    add(sub(legacyWardsByProvince, w.provinceCode), w.name, w);
  }

  return {
    meta: units.meta,
    provinces: units.provinces,
    wards: units.wards,
    provinceByCode: new Map(units.provinces.map((p) => [p.code, p])),
    wardByCode: new Map(units.wards.map((w) => [w.code, w])),
    provinceIndex,
    wardsByProvince,
    legacyProvinces: legacy.provinces,
    legacyDistricts: legacy.districts,
    legacyWards: legacy.wards,
    legacyProvinceByCode: new Map(legacy.provinces.map((p) => [p.code, p])),
    legacyProvinceIndex,
    legacyDistrictsByProvince,
    legacyDistrictByKey: new Map(legacy.districts.map((d) => [`${d.provinceCode}/${d.code}`, d])),
    legacyWardsByDistrict,
    legacyWardsByProvince,
  };
}

let cached: Database | undefined;
export function getDatabase(): Database {
  return (cached ??= buildDatabase());
}

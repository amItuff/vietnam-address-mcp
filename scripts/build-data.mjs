#!/usr/bin/env node
// Builds data/units.json and data/legacy.json from two pinned, MIT-licensed upstream datasets.
//
//   node scripts/build-data.mjs --units <checkout> --mapping <checkout>
//
// Each checkout must be at the commit pinned in data/sources.json. The script fails loudly
// on any inconsistency instead of emitting partial data.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(readFileSync(join(root, 'data/sources.json'), 'utf8'));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) fail(`missing --${name} <path to checkout>`);
  return resolve(process.argv[i + 1]);
}
function fail(msg) {
  console.error(`build-data: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(`validation failed: ${msg}`);
}
function checkout(dir, pinned, label) {
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== pinned) fail(`${label} checkout is at ${head}, expected pinned ${pinned}`);
}

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, embedded newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const WARD_TYPES = ['Phường', 'Xã', 'Đặc khu', 'Thị trấn'];
const PROVINCE_TYPES = ['Thành phố', 'Tỉnh'];
const DISTRICT_TYPES = ['Quận', 'Huyện', 'Thị xã', 'Thành phố'];

// Upstream sometimes lowercases the type ("xã Bắc Sơn"); canonicalise it.
function split(fullName, types, what) {
  const clean = fullName.trim().replace(/\s+/g, ' ');
  const lower = clean.toLowerCase();
  for (const t of types) {
    if (lower.startsWith(t.toLowerCase() + ' ')) {
      return { type: t, name: clean.slice(t.length + 1), fullName: `${t} ${clean.slice(t.length + 1)}` };
    }
  }
  return fail(`cannot split ${what} name: "${fullName}"`);
}
const pad = (n, w) => String(n).padStart(w, '0');
const int = (s) => { const n = Number(s); assert(Number.isInteger(n), `not an integer: "${s}"`); return n; };

const unitsDir = arg('units');
const mappingDir = arg('mapping');
checkout(unitsDir, sources.units.commit, 'units');
checkout(mappingDir, sources.mapping.commit, 'mapping');

// ---- current units ---------------------------------------------------------------------
const rawUnits = JSON.parse(readFileSync(join(unitsDir, sources.units.file), 'utf8'));
const provinces = [];
const wards = [];
for (const p of rawUnits) {
  const ps = split(p.FullName, PROVINCE_TYPES, 'province');
  provinces.push({ code: p.Code, type: ps.type, name: ps.name, fullName: ps.fullName });
  for (const w of p.Wards) {
    const ws = split(w.FullName, WARD_TYPES, 'ward');
    wards.push({ code: w.Code, type: ws.type, name: ws.name, fullName: ws.fullName, provinceCode: p.Code });
  }
}
provinces.sort((a, b) => a.code.localeCompare(b.code));
wards.sort((a, b) => a.code.localeCompare(b.code));
assert(provinces.length === 34, `expected 34 provinces, got ${provinces.length}`);
assert(wards.length === 3321, `expected 3321 wards, got ${wards.length}`);
assert(new Set(wards.map((w) => w.code)).size === wards.length, 'duplicate current ward codes');
const wardByCode = new Map(wards.map((w) => [w.code, w]));

// ---- legacy hierarchy + mapping --------------------------------------------------------
const rows = parseCsv(readFileSync(join(mappingDir, sources.mapping.file), 'utf8'));
assert(rows.length === 10602, `expected 10602 mapping rows, got ${rows.length}`);

const legacyProvinces = new Map();
const legacyDistricts = new Map();
const legacyWards = new Map();
const bool = (s) => s === 'True';

for (const r of rows) {
  const pc = pad(int(r.provinceCode), 2);
  const dc = pad(int(r.districtCode), 3);
  const ps = split(r.province, PROVINCE_TYPES, 'legacy province');
  if (!legacyProvinces.has(pc)) legacyProvinces.set(pc, { code: pc, type: ps.type, name: ps.name, fullName: ps.fullName });

  const ds = split(r.district, DISTRICT_TYPES, 'legacy district');
  const dkey = `${pc}/${dc}`;
  if (!legacyDistricts.has(dkey)) {
    legacyDistricts.set(dkey, { code: dc, provinceCode: pc, type: ds.type, name: ds.name, fullName: ds.fullName });
  }

  const target = pad(int(r.newWardCode), 5);
  const newProvince = pad(int(r.newProvinceCode), 2);
  const cur = wardByCode.get(target);
  assert(cur, `mapping targets unknown ward code ${target}`);
  assert(cur.provinceCode === newProvince, `ward ${target} province mismatch (${cur.provinceCode} vs ${newProvince})`);

  if (r.wardCode === '') {
    // Island districts (Bạch Long Vĩ, Cồn Cỏ, Hoàng Sa, Lý Sơn, Côn Đảo) become one special zone.
    const d = legacyDistricts.get(dkey);
    assert(!d.target, `district ${dkey} has two district-level targets`);
    d.target = target;
    continue;
  }
  const wc = pad(int(r.wardCode), 5);
  const wsplit = split(r.ward, WARD_TYPES, 'legacy ward');
  let w = legacyWards.get(wc);
  if (!w) {
    w = { code: wc, districtCode: dc, provinceCode: pc, type: wsplit.type, name: wsplit.name, fullName: wsplit.fullName, targets: [], defaultTarget: null };
    legacyWards.set(wc, w);
  }
  assert(w.districtCode === dc && w.provinceCode === pc, `legacy ward ${wc} appears under two districts`);
  assert(!w.targets.includes(target), `legacy ward ${wc} lists target ${target} twice`);
  w.targets.push(target);
  if (bool(r.isDefaultNewWard)) {
    assert(w.defaultTarget === null, `legacy ward ${wc} has two default targets`);
    w.defaultTarget = target;
  }
}

for (const w of legacyWards.values()) {
  if (w.targets.length === 1) w.defaultTarget = w.targets[0];
  assert(w.defaultTarget, `legacy ward ${w.code} (${w.fullName}) has ${w.targets.length} targets and no default`);
  w.split = w.targets.length > 1;
}

const lp = [...legacyProvinces.values()].sort((a, b) => a.code.localeCompare(b.code));
const ld = [...legacyDistricts.values()].sort((a, b) => (a.provinceCode + a.code).localeCompare(b.provinceCode + b.code));
const lw = [...legacyWards.values()].sort((a, b) => a.code.localeCompare(b.code));

assert(lp.length === 63, `expected 63 legacy provinces, got ${lp.length}`);
assert(lw.length + ld.filter((d) => d.target).length === 10040, 'legacy ward + island district count != 10040');
assert(ld.filter((d) => d.target).length === 5, 'expected exactly 5 island districts');
const covered = new Set([...lw.flatMap((w) => w.targets), ...ld.filter((d) => d.target).map((d) => d.target)]);
assert(covered.size === 3321, `mapping covers ${covered.size} of 3321 current wards`);

// Info: how many current names differ from the mapping's snapshot (renames vs. spelling).
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
let spelling = 0, renamed = 0;
for (const r of rows) {
  const cur = wardByCode.get(pad(int(r.newWardCode), 5));
  const snap = split(r.newWard, WARD_TYPES, 'snapshot ward').fullName;
  if (snap === cur.fullName) continue;
  if (strip(snap) === strip(cur.fullName)) spelling++; else renamed++;
}

const meta = {
  generatedBy: 'scripts/build-data.mjs',
  sources,
  counts: { provinces: provinces.length, wards: wards.length, legacyProvinces: lp.length, legacyDistricts: ld.length, legacyWards: lw.length, splitLegacyWards: lw.filter((w) => w.split).length },
};
writeFileSync(join(root, 'data/units.json'), JSON.stringify({ meta, provinces, wards }) + '\n');
writeFileSync(join(root, 'data/legacy.json'), JSON.stringify({ meta, provinces: lp, districts: ld, wards: lw }) + '\n');

console.log('OK', meta.counts);
console.log(`name drift vs mapping snapshot (rows): spelling-only=${spelling}, type/name changes=${renamed}`);

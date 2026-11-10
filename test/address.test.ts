import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, resolveLegacy, resolveCurrent, splitAddress, splitLeadingStreet } from '../src/address.ts';
import { getDatabase } from '../src/data.ts';

const db = getDatabase();
const to = (text: string) => normalizeAddress(text).address?.formatted;

test('legacy 3-level address converts, street is preserved', () => {
  const r = normalizeAddress('12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM');
  assert.equal(r.status, 'ok');
  assert.equal(r.inputFormat, 'legacy');
  assert.equal(r.confidence, 'exact');
  assert.equal(r.street, '12 Lê Lợi');
  assert.equal(r.address?.formatted, 'Phường Sài Gòn, Thành phố Hồ Chí Minh');
  assert.equal(r.address?.formattedWithStreet, '12 Lê Lợi, Phường Sài Gòn, Thành phố Hồ Chí Minh');
});

test('accent-less, abbreviated input resolves the same', () => {
  assert.equal(to('12 le loi, p ben nghe, q1, tphcm'), 'Phường Sài Gòn, Thành phố Hồ Chí Minh');
});

test('district type may be omitted', () => {
  assert.equal(to('Phường Phúc Xá, Ba Đình, Hà Nội'), 'Phường Hồng Hà, Thành phố Hà Nội');
});

test('"Phường 1" without a district is ambiguous, never guessed', () => {
  const r = normalizeAddress('Phường 1, TP Hồ Chí Minh');
  assert.equal(r.status, 'ambiguous');
  assert.ok((r.candidates?.length ?? 0) > 1);
  assert.equal(r.address, undefined);
});

test('"Phường 1" with a district is exact', () => {
  assert.equal(to('Phường 1, Quận 3, TPHCM'), 'Phường Bàn Cờ, Thành phố Hồ Chí Minh');
});

test('a divided legacy ward reports the default AND the alternatives', () => {
  const r = normalizeAddress('Phường Cống Vị, Quận Ba Đình, Hà Nội');
  assert.equal(r.status, 'ok');
  assert.equal(r.confidence, 'split_default');
  assert.equal(r.address?.ward.fullName, 'Phường Ngọc Hà');
  assert.deepEqual(r.alternatives?.map((a) => a.ward.fullName), ['Phường Giảng Võ']);
  assert.ok(r.notes.some((n) => /divided/.test(n)));
});

test('island district maps to its special zone', () => {
  assert.equal(to('Huyện Côn Đảo, Bà Rịa - Vũng Tàu'), 'Đặc khu Côn Đảo, Thành phố Hồ Chí Minh');
});

test('districts sharing a short name are told apart by the ward', () => {
  const r = normalizeAddress('Xã Kỳ Khang, Kỳ Anh, Hà Tĩnh');
  assert.equal(r.status, 'ok');
  assert.equal(r.from?.district?.fullName, 'Huyện Kỳ Anh');
});

test('a district whose name starts with a type word still works', () => {
  assert.equal(normalizeAddress('Xã Phú Lệ, Quan Hóa, Thanh Hóa').status, 'ok');
});

test('an address already in the new structure is validated, not re-converted', () => {
  const r = normalizeAddress('5 Nguyễn Huệ, Phường Sài Gòn, TP Hồ Chí Minh');
  assert.equal(r.inputFormat, 'current');
  assert.equal(r.address?.formattedWithStreet, '5 Nguyễn Huệ, Phường Sài Gòn, Thành phố Hồ Chí Minh');
});

test('a stale unit type is corrected with an explanation (Xã Bố Hạ → Phường Bố Hạ)', () => {
  const r = normalizeAddress('Xã Bố Hạ, Bắc Ninh');
  assert.equal(r.address?.formatted, 'Phường Bố Hạ, Thành phố Bắc Ninh');
  assert.ok(r.notes.some((n) => /type changed/.test(n)));
});

test('street glued to the ward is split off', () => {
  const r = normalizeAddress('12 Lê Lợi phường Bến Nghé, Quận 1, HCM');
  assert.equal(r.address?.formatted, 'Phường Sài Gòn, Thành phố Hồ Chí Minh');
  assert.equal(r.street, '12 Lê Lợi');
});

test('a street containing "Xa lộ" is not mistaken for a ward; Thủ Đức stays legacy', () => {
  const r = normalizeAddress('Số 8 Xa lộ Hà Nội phường Linh Trung, Thủ Đức, TPHCM');
  assert.equal(r.inputFormat, 'legacy');
  assert.equal(r.from?.ward?.fullName, 'Phường Linh Trung');
  assert.equal(r.street, 'Số 8 Xa lộ Hà Nội');
});

test('a name that is both a current ward and an old district carries a warning', () => {
  const r = normalizeAddress('Thủ Đức, TPHCM');
  assert.equal(r.address?.formatted, 'Phường Thủ Đức, Thành phố Hồ Chí Minh');
  assert.ok(r.notes.some((n) => /pre-2025 district/.test(n)));
});

test('country suffix is ignored', () => {
  assert.equal(to('Phường Bến Nghé, Quận 1, Hồ Chí Minh, Việt Nam'), 'Phường Sài Gòn, Thành phố Hồ Chí Minh');
});

test('typos produce suggestions inside the right province, not a guess', () => {
  const r = normalizeAddress('Phường Ben Ngé, Quận 1, HCM');
  assert.equal(r.status, 'not_found');
  assert.ok(r.didYouMean?.some((s) => s.includes('Bến Nghé')));
  assert.ok(r.didYouMean?.every((s) => s.includes('Hồ Chí Minh')));
});

test('garbage and too-short input are rejected cleanly', () => {
  assert.equal(normalizeAddress('abc').status, 'not_found');
  assert.equal(normalizeAddress('Phường Zzzz, Quận 1, Atlantis').status, 'not_found');
  assert.equal(normalizeAddress('').status, 'not_found');
});

test('resolveLegacy with a missing province / wrong district reports not_found', () => {
  assert.equal(resolveLegacy({ province: 'Nowhere', ward: 'X' }).status, 'not_found');
  assert.equal(resolveLegacy({ province: 'Hà Nội', district: 'Quận 1', ward: 'Phường Bến Nghé' }).status, 'not_found');
});

test('resolveCurrent rejects an old-only name', () => {
  assert.equal(resolveCurrent({ province: 'Hồ Chí Minh', ward: 'Phường Bến Nghé' }).status, 'not_found');
});

test('splitters', () => {
  assert.deepEqual(splitAddress('a , b;; c\n d, Việt Nam'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitLeadingStreet('12 Lê Lợi phường Bến Nghé'), ['12 Lê Lợi', 'phường Bến Nghé']);
  assert.equal(splitLeadingStreet('Phường Bến Nghé'), null);
});

// ---- exhaustive round trips over the whole dataset ---------------------------------------

test('every legacy ward, written in full, converts to one of its own targets', () => {
  const failures: string[] = [];
  for (const w of db.legacyWards) {
    const d = db.legacyDistrictByKey.get(`${w.provinceCode}/${w.districtCode}`)!;
    const p = db.legacyProvinceByCode.get(w.provinceCode)!;
    const r = normalizeAddress(`${w.fullName}, ${d.fullName}, ${p.fullName}`);
    const ok =
      r.status === 'ok' &&
      r.from?.ward?.code === w.code &&
      w.targets.includes(r.address!.ward.code) &&
      r.address!.ward.code === w.defaultTarget;
    if (!ok) failures.push(`${w.fullName}, ${d.fullName}, ${p.fullName} → ${r.status} ${r.summary}`);
  }
  assert.equal(failures.length, 0, `${failures.length} failures, first: ${failures.slice(0, 5).join(' | ')}`);
});

test('every island district, written in full, converts', () => {
  for (const d of db.legacyDistricts.filter((x) => x.target)) {
    const p = db.legacyProvinceByCode.get(d.provinceCode)!;
    const r = normalizeAddress(`${d.fullName}, ${p.fullName}`);
    assert.equal(r.address?.ward.code, d.target, d.fullName);
  }
});

test('every current ward, written in full, resolves to itself', () => {
  const failures: string[] = [];
  for (const w of db.wards) {
    const p = db.provinceByCode.get(w.provinceCode)!;
    const r = normalizeAddress(`${w.fullName}, ${p.fullName}`);
    if (r.status !== 'ok' || r.address?.ward.code !== w.code) failures.push(`${w.fullName}, ${p.fullName} → ${r.status} ${r.summary}`);
  }
  assert.equal(failures.length, 0, `${failures.length} failures, first: ${failures.slice(0, 5).join(' | ')}`);
});

test('accent-less input: unique names resolve exactly, diacritic-twins are reported ambiguous', () => {
  const strip = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const groups = new Map<string, string[]>();
  for (const w of db.wards) {
    const k = `${w.provinceCode}|${strip(w.fullName).toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), w.code]);
  }
  let twins = 0;
  for (const w of db.wards) {
    const p = db.provinceByCode.get(w.provinceCode)!;
    const siblings = groups.get(`${w.provinceCode}|${strip(w.fullName).toLowerCase()}`)!;
    const r = normalizeAddress(strip(`1 Đường A, ${w.fullName}, ${p.fullName}`));
    if (siblings.length === 1) {
      assert.equal(r.status, 'ok', w.fullName);
      assert.equal(r.address?.ward.code, w.code, w.fullName);
    } else {
      twins++;
      assert.equal(r.status, 'ambiguous', w.fullName);
      const codes = r.candidates!.map((c) => c.to.ward.code).sort();
      assert.deepEqual(codes, [...siblings].sort(), w.fullName);
    }
  }
  assert.ok(twins > 0 && twins < 40, `unexpected number of diacritic twins: ${twins}`);
});

test('with diacritics the twins are told apart', () => {
  assert.equal(to('Xã Văn Lang, Thái Nguyên'), 'Xã Văn Lang, Tỉnh Thái Nguyên');
  assert.equal(to('Xã Văn Lăng, Thái Nguyên'), 'Xã Văn Lăng, Tỉnh Thái Nguyên');
});

// Golden cases cross-checked against Nghị quyết 1685/NQ-UBTVQH15 (TP.HCM) as reported by
// independent news and legal-database pages, not only the upstream dataset.
test('golden: wards the resolution merges or divides are flagged correctly', () => {
  const sgBenNghe = normalizeAddress('Phường Bến Nghé, Quận 1, TPHCM');
  assert.equal(sgBenNghe.address?.ward.fullName, 'Phường Sài Gòn');
  assert.equal(sgBenNghe.confidence, 'exact');

  const daKao = normalizeAddress('Phường Đa Kao, Quận 1, TPHCM'); // split: Sài Gòn + Tân Định
  assert.equal(daKao.confidence, 'split_default');
  const daKaoAll = [daKao.address!.ward.fullName, ...daKao.alternatives!.map((a) => a.ward.fullName)].sort();
  assert.deepEqual(daKaoAll, ['Phường Sài Gòn', 'Phường Tân Định']);

  const p4 = normalizeAddress('Phường 4, Quận 3, TPHCM'); // partly Bàn Cờ
  assert.equal(p4.confidence, 'split_default');
  assert.ok([p4.address!.ward.fullName, ...p4.alternatives!.map((a) => a.ward.fullName)].includes('Phường Bàn Cờ'));
});

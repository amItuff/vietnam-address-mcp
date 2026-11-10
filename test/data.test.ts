import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../src/data.ts';

const db = getDatabase();

test('dataset sizes match the official structure', () => {
  assert.equal(db.provinces.length, 34);
  assert.equal(db.wards.length, 3321);
  assert.equal(db.legacyProvinces.length, 63);
  const islands = db.legacyDistricts.filter((d) => d.target);
  assert.equal(islands.length, 5);
  assert.equal(db.legacyWards.length + islands.length, 10040);
});

test('every mapping target is a real current ward in a real current province', () => {
  for (const w of db.legacyWards) {
    for (const t of w.targets) {
      const cur = db.wardByCode.get(t);
      assert.ok(cur, `${w.fullName}: unknown target ${t}`);
      assert.ok(db.provinceByCode.has(cur.provinceCode));
    }
  }
});

test('divided wards always have a default that is one of their targets', () => {
  const split = db.legacyWards.filter((w) => w.split);
  assert.equal(split.length, 471);
  for (const w of split) {
    assert.ok(w.targets.length > 1);
    assert.ok(w.targets.includes(w.defaultTarget), w.fullName);
  }
});

test('every current ward is reachable from at least one legacy unit', () => {
  const reached = new Set<string>();
  for (const w of db.legacyWards) w.targets.forEach((t) => reached.add(t));
  for (const d of db.legacyDistricts) if (d.target) reached.add(d.target);
  assert.equal(reached.size, 3321);
});

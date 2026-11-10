import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchUnits } from '../src/search.ts';

test('finds a current ward by name, accent-insensitive, ranked exact-first', () => {
  const hits = searchUnits({ query: 'sai gon', level: 'ward' });
  assert.equal(hits[0]?.fullName, 'Phường Sài Gòn');
  assert.equal(hits[0]?.path, 'Phường Sài Gòn, Thành phố Hồ Chí Minh');
});

test('finds provinces and honours the province filter', () => {
  assert.equal(searchUnits({ query: 'ha noi', level: 'province' })[0]?.fullName, 'Thành phố Hà Nội');
  const hits = searchUnits({ query: 'tan', level: 'ward', province: 'TP.HCM', limit: 50 });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.path.endsWith('Thành phố Hồ Chí Minh')));
});

test('legacy search returns where each old unit maps to today', () => {
  const hits = searchUnits({ query: 'cong vi', scope: 'legacy', level: 'ward' });
  const h = hits[0]!;
  assert.equal(h.fullName, 'Phường Cống Vị');
  assert.equal(h.now?.length, 2);
  assert.equal(h.now?.filter((n) => n.isDefault).length, 1);
});

test('legacy search covers districts, which no longer exist', () => {
  const hits = searchUnits({ query: 'thu duc', scope: 'legacy', level: 'district' });
  assert.ok(hits.some((h) => h.fullName === 'Thành phố Thủ Đức'));
});

test('limit is respected and nonsense returns nothing', () => {
  assert.equal(searchUnits({ query: 'a', limit: 3 }).length, 3);
  assert.equal(searchUnits({ query: 'zzzzqqqq' }).length, 0);
  assert.equal(searchUnits({ query: '   ' }).length, 0);
  assert.equal(searchUnits({ query: 'tan', province: 'Atlantis' }).length, 0);
});

test('a small typo still finds the unit', () => {
  assert.ok(searchUnits({ query: 'ben nge', level: 'ward', scope: 'legacy' }).some((h) => h.fullName === 'Phường Bến Nghé'));
});

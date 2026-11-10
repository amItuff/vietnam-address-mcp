import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, fold, indexKey, parseName } from '../src/text.ts';

test('fold removes diacritics and punctuation, maps đ', () => {
  assert.equal(fold('Thành phố Hồ Chí Minh'), 'thanh pho ho chi minh');
  assert.equal(fold('  Đắk Lắk. '), 'dak lak');
});

test('tone-mark placement does not matter (Hoà vs Hòa)', () => {
  assert.equal(indexKey('Hoà Bình'), indexKey('Hòa Bình'));
});

test('type words are stripped, abbreviations expanded', () => {
  assert.equal(parseName('Phường Bến Nghé', 'ward').bare, 'ben nghe');
  assert.equal(parseName('P.5', 'ward').bare, '5');
  assert.equal(parseName('p5', 'ward').type, 'phuong');
  assert.equal(parseName('Q.10', 'district').bare, '10');
  assert.equal(parseName('TP. Hồ Chí Minh', 'province').bare, 'ho chi minh');
  assert.equal(parseName('Phường 05', 'ward').bare, '5');
});

test('a real name that starts with a type word is kept as written first', () => {
  // Huyện Quan Hóa: "quan" must not be mistaken for the type "Quận".
  assert.equal(parseName('Quan Hóa', 'district').keys[0], 'quan hoa');
  assert.equal(parseName('Huyện Quan Hóa', 'district').bare, 'quan hoa');
});

test('compact fallback handles missing spaces', () => {
  assert.ok(parseName('hochiminh', 'province').keys.includes('hochiminh'));
});

test('editDistance', () => {
  assert.equal(editDistance('nghe', 'nge', 3), 1);
  assert.equal(editDistance('abc', 'xyzxyz', 2), 3); // capped: cap + 1
});

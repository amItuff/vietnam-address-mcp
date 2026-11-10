import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCsv, parseCsv } from '../src/csv.ts';
import { convertCsv } from '../src/batch.ts';

test('parseCsv handles quotes, embedded commas/newlines, escaped quotes, BOM and CRLF', () => {
  const { rows, delimiter } = parseCsv('﻿id,address\r\n1,"12 Lê Lợi, Quận 1"\r\n2,"say ""hi""\nline"\r\n');
  assert.equal(delimiter, ',');
  assert.deepEqual(rows, [['id', 'address'], ['1', '12 Lê Lợi, Quận 1'], ['2', 'say "hi"\nline']]);
});

test('parseCsv detects semicolons and tabs; formatCsv round-trips', () => {
  assert.equal(parseCsv('a;b\n1;2\n').delimiter, ';');
  assert.equal(parseCsv('a\tb\n1\t2\n').delimiter, '\t');
  const rows = [['a', 'b'], ['x,y', 'q"z']];
  assert.deepEqual(parseCsv(formatCsv(rows)).rows, rows);
});

test('parseCsv rejects an unterminated quote', () => {
  assert.throws(() => parseCsv('a,b\n1,"oops\n'), /Unterminated/);
});

test('convertCsv appends result columns and keeps the original ones', () => {
  const input = 'id,Address,note\n1,"12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM",vip\n2,"nowhere, xyz",\n3,"Phường Cống Vị, Ba Đình, Hà Nội",\n';
  const { csv, summary, total } = convertCsv(input, { column: 'address' });
  const { rows } = parseCsv(csv);
  assert.deepEqual(rows[0], ['id', 'Address', 'note', 'new_address', 'address_status', 'address_confidence', 'address_note']);
  assert.equal(total, 3);
  assert.equal(rows[1]?.[3], '12 Lê Lợi, Phường Sài Gòn, Thành phố Hồ Chí Minh');
  assert.equal(rows[1]?.[4], 'ok');
  assert.equal(rows[2]?.[3], '');
  assert.equal(rows[2]?.[4], 'not_found');
  assert.equal(rows[3]?.[5], 'split_default');
  assert.equal(summary.not_found, 1);
});

test('convertCsv explains a missing column or a name clash', () => {
  assert.throws(() => convertCsv('id,addr\n1,x\n', { column: 'address' }), /not found.*id, addr/);
  assert.throws(() => convertCsv('address,address_status\nx,y\n', { column: 'address' }), /already has column/);
});

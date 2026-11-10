import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.ts';

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
const text = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0] as { text: string }).text);

test('exposes exactly the four documented, read-only tools', async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['convert_legacy_address', 'normalize_address', 'normalize_addresses', 'search_units']);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
    assert.ok((t.description?.length ?? 0) > 80, `${t.name} needs a real description`);
  }
  assert.match(c.getInstructions() ?? '', /split_default/);
});

test('normalize_address over the protocol', async () => {
  const c = await connect();
  const r = text(await c.callTool({ name: 'normalize_address', arguments: { address: '12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM' } }));
  assert.equal(r.status, 'ok');
  assert.equal(r.address.formattedWithStreet, '12 Lê Lợi, Phường Sài Gòn, Thành phố Hồ Chí Minh');
  assert.match(r.dataVersion.currentThrough, /388\/NQ-UBTVQH16/);
  assert.equal(r.dataVersion.effectiveDate, '2026-09-20');
});

test('normalize_addresses returns ordered results and a summary', async () => {
  const c = await connect();
  const r = text(
    await c.callTool({
      name: 'normalize_addresses',
      arguments: { addresses: ['12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM', 'khong ro dau, xyz', 'Phường Cống Vị, Ba Đình, Hà Nội'] },
    }),
  );
  assert.equal(r.total, 3);
  assert.deepEqual(r.items.map((i: { index: number }) => i.index), [0, 1, 2]);
  assert.equal(r.items[0].result.status, 'ok');
  assert.equal(r.items[1].result.status, 'not_found');
  assert.equal(r.summary.ok + r.summary.ambiguous + r.summary.not_found, 3);
  assert.equal(r.summary.splitDefault, 1);
});

test('normalize_addresses refuses more than 200 addresses', async () => {
  const c = await connect();
  const r = await c.callTool({ name: 'normalize_addresses', arguments: { addresses: Array(201).fill('a, b') } }).catch((e: unknown) => e);
  assert.ok(r instanceof Error || (r as { isError?: boolean }).isError === true);
});

test('convert_legacy_address over the protocol, including a divided ward', async () => {
  const c = await connect();
  const r = text(await c.callTool({ name: 'convert_legacy_address', arguments: { province: 'Hà Nội', district: 'Ba Đình', ward: 'Cống Vị' } }));
  assert.equal(r.confidence, 'split_default');
  assert.equal(r.alternatives.length, 1);
});

test('search_units over the protocol, with defaults applied', async () => {
  const c = await connect();
  const r = text(await c.callTool({ name: 'search_units', arguments: { query: 'sai gon' } }));
  assert.equal(r.results[0].fullName, 'Phường Sài Gòn');
});

test('invalid input is rejected by the schema, not by a crash', async () => {
  const c = await connect();
  const r = await c.callTool({ name: 'normalize_address', arguments: { address: '' } }).catch((e: unknown) => e);
  const failed = r instanceof Error || (r as { isError?: boolean }).isError === true;
  assert.ok(failed);
});

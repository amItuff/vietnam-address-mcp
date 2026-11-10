#!/usr/bin/env node
// End-to-end check: starts the BUILT server over stdio exactly as an MCP client would.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';

const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
assert.equal(tools.length, 4);
const res = await client.callTool({
  name: 'normalize_address',
  arguments: { address: '12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM' },
});
const out = JSON.parse(res.content[0].text);
assert.equal(out.address.formatted, 'Phường Sài Gòn, Thành phố Hồ Chí Minh');
await client.close();
console.log(`smoke ok: ${tools.map((t) => t.name).join(', ')}`);

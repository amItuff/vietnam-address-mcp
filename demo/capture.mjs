#!/usr/bin/env node
// Runs the BUILT server over stdio with a real MCP client and records the exchanges.
// demo/render.py draws the GIF from this transcript, so nothing in the GIF is hand-typed.
//   npm run build && node demo/capture.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';

const scenes = [
  { tool: 'normalize_address', args: { address: '12 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM' } },
  { tool: 'normalize_address', args: { address: 'Phường Cống Vị, Quận Ba Đình, Hà Nội' } },
  { tool: 'normalize_address', args: { address: 'Phường 1, TP Hồ Chí Minh' } },
];

const client = new Client({ name: 'demo-capture', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'] }));
const out = [];
for (const s of scenes) {
  const res = await client.callTool({ name: s.tool, arguments: s.args });
  out.push({ ...s, result: JSON.parse(res.content[0].text) });
}
await client.close();
writeFileSync(new URL('./transcript.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`captured ${out.length} scenes → demo/transcript.json`);

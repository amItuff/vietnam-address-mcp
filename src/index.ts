#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  console.log(pkg.version);
} else if (arg === '--help' || arg === '-h') {
  console.log('vietnam-address-mcp: MCP server (stdio) for Vietnamese address normalisation.\nSee https://github.com/amItuff/vietnam-address-mcp');
} else {
  // stdout carries the protocol; every log line must go to stderr.
  await createServer().connect(new StdioServerTransport());
  console.error('vietnam-address-mcp ready (stdio)');
}

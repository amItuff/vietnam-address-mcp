#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { convertCsv } from './batch.ts';
import { createServer } from './server.ts';

const USAGE = `vietnam-address-mcp: MCP server (stdio) for Vietnamese address normalisation.

Usage:
  vietnam-address-mcp                      start the MCP server on stdio
  vietnam-address-mcp csv <input.csv> --column <name> [--output <file>] [--delimiter <c>]
                                           add new_address, address_status, address_confidence, address_note columns to a CSV
  vietnam-address-mcp --version

https://github.com/amItuff/vietnam-address-mcp`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function runCsv(args: string[]): void {
  const input = args[0];
  const column = flag(args, '--column');
  if (!input || input.startsWith('--') || !column) {
    console.error('Usage: vietnam-address-mcp csv <input.csv> --column <name> [--output <file>] [--delimiter <c>]');
    process.exit(2);
  }
  try {
    const delimiter = flag(args, '--delimiter');
    const result = convertCsv(readFileSync(input, 'utf8'), { column, ...(delimiter ? { delimiter } : {}) });
    const output = flag(args, '--output');
    if (output) writeFileSync(output, result.csv);
    else process.stdout.write(result.csv);
    const s = result.summary;
    console.error(`${result.total} rows: ${s.ok} ok (${s.splitDefault} divided-ward defaults), ${s.ambiguous} ambiguous, ${s.not_found} not found`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-v') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  console.log(pkg.version);
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log(USAGE);
} else if (args[0] === 'csv') {
  runCsv(args.slice(1));
} else {
  // stdout carries the protocol; every log line must go to stderr.
  await createServer().connect(new StdioServerTransport());
  console.error('vietnam-address-mcp ready (stdio)');
}

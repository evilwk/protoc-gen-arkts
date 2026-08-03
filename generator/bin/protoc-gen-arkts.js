#!/usr/bin/env node

import { runPlugin } from '../dist/index.js';

if (process.argv.includes('--version')) {
  process.stdout.write('protoc-gen-arkts 0.4.0\n');
  process.exit(0);
}

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  try {
    const response = runPlugin(Buffer.concat(chunks));
    process.stdout.write(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`protoc-gen-arkts: ${message}\n`);
    process.exitCode = 1;
  }
});
process.stdin.on('error', (error) => {
  process.stderr.write(`protoc-gen-arkts: failed to read stdin: ${error.message}\n`);
  process.exitCode = 1;
});

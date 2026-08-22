#!/usr/bin/env node
/**
 * scripts/generate-brand-icons.mjs
 * Deterministic execution wrapper for OpenOb brand asset generation.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pythonScript = path.join(__dirname, 'generate_brand_icons.py');

const result = spawnSync('python', [pythonScript], {
  stdio: 'inherit',
  cwd: path.dirname(__dirname),
});

if (result.status !== 0) {
  console.error('[BrandGen] Failed to generate brand assets with status', result.status);
  process.exit(result.status ?? 1);
}

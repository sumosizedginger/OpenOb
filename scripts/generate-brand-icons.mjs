#!/usr/bin/env node
/**
 * scripts/generate-brand-icons.mjs
 * Robust, cross-platform deterministic execution wrapper for OpenOb brand asset generation.
 * Searches for configured PYTHON, `python`, or `python3` across Windows, macOS, and Linux.
 */

import { spawnSync } from 'node:child_process';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pythonScript = path.join(__dirname, 'generate_brand_icons.py');
const rootDir = path.dirname(__dirname);

function findPythonExecutable() {
  const candidates = [];
  if (process.env.PYTHON) {
    candidates.push(process.env.PYTHON);
  }
  candidates.push('python', 'python3');

  for (const cmd of candidates) {
    try {
      const probe = spawnSync(cmd, ['--version'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (probe.status === 0) {
        return cmd;
      }
    } catch {
      // Continue searching next candidate
    }
  }
  return null;
}

const pythonBin = findPythonExecutable();

if (!pythonBin) {
  console.error('\n[BrandGen Error] Python 3 executable not found.');
  console.error('To generate brand assets, ensure Python 3 is installed with Pillow and NumPy:');
  console.error('\n    python -m pip install -r scripts/requirements-brand.txt');
  console.error('    npm run brand:generate\n');
  process.exit(1);
}

const result = spawnSync(pythonBin, [pythonScript], {
  stdio: 'inherit',
  cwd: rootDir,
});

if (result.status !== 0) {
  console.error('\n[BrandGen Error] Failed to generate brand assets with status:', result.status);
  console.error('Please verify that required Python packages are installed:');
  console.error('\n    python -m pip install -r scripts/requirements-brand.txt\n');
  process.exit(result.status ?? 1);
}

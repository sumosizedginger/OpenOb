import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let outdir = path.resolve(__dirname, 'dist');
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--outdir' && i + 1 < process.argv.length) {
    outdir = path.resolve(process.argv[++i]);
  }
}

import child_process from 'node:child_process';

let buildSha = process.env.OPENOB_BUILD_SHA || '';
let sourceClean = process.env.OPENOB_SOURCE_CLEAN !== 'false';

if (!buildSha) {
  try {
    buildSha = child_process.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const status = child_process.execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    sourceClean = status.length === 0;
  } catch {
    buildSha = 'dev';
    sourceClean = true;
  }
}

async function build() {
  await fs.rm(outdir, { recursive: true, force: true });
  await fs.mkdir(outdir, { recursive: true });

  await esbuild.build({
    entryPoints: {
      main: path.resolve(__dirname, 'src/main.ts'),
      preload: path.resolve(__dirname, 'src/preload.ts'),
    },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outdir,
    outExtension: { '.js': '.cjs' },
    external: ['electron', 'sql.js'],
    define: {
      'process.env.OPENOB_BUILD_SHA': JSON.stringify(buildSha),
      'process.env.OPENOB_SOURCE_CLEAN': JSON.stringify(sourceClean ? 'true' : 'false'),
    },
    sourcemap: true,
  });

  // Copy icon assets into dist for window runtime icon resolution
  const buildDir = path.resolve(__dirname, 'build');
  const iconIco = path.join(buildDir, 'icon.ico');
  const iconPng = path.join(buildDir, 'icon.png');
  const iconsDir = path.join(buildDir, 'icons');

  try {
    if (
      await fs
        .stat(iconIco)
        .then(() => true)
        .catch(() => false)
    ) {
      await fs.copyFile(iconIco, path.join(outdir, 'icon.ico'));
    }
    if (
      await fs
        .stat(iconPng)
        .then(() => true)
        .catch(() => false)
    ) {
      await fs.copyFile(iconPng, path.join(outdir, 'icon.png'));
    }
    if (
      await fs
        .stat(iconsDir)
        .then(() => true)
        .catch(() => false)
    ) {
      await fs.cp(iconsDir, path.join(outdir, 'icons'), { recursive: true });
    }
  } catch (err) {
    process.stderr.write(`[OpenOb Desktop] Warning copying icons: ${err?.message}\n`);
  }

  process.stdout.write(`[OpenOb Desktop] Build complete -> ${outdir}\n`);
}

build().catch((err) => {
  process.stderr.write(`[OpenOb Desktop] Build failed: ${err?.message || String(err)}\n`);
  process.exit(1);
});

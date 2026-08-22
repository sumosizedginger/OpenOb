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
    sourcemap: true,
  });

  process.stdout.write(`[OpenOb Desktop] Build complete -> ${outdir}\n`);
}

build().catch((err) => {
  process.stderr.write(`[OpenOb Desktop] Build failed: ${err?.message || String(err)}\n`);
  process.exit(1);
});

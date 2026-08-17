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
  await fs.mkdir(outdir, { recursive: true });

  await esbuild.build({
    entryPoints: {
      'bin/gateway': path.resolve(__dirname, 'src/bin/gateway.ts'),
      'bin/cli': path.resolve(__dirname, 'src/bin/cli.ts'),
      index: path.resolve(__dirname, 'src/index.ts'),
    },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outdir,
    external: ['sql.js'],
    sourcemap: true,
  });

  process.stdout.write(`[OpenOb Gateway] Build complete -> ${outdir}\n`);
}

build().catch((err) => {
  process.stderr.write(`[OpenOb Gateway] Build failed: ${err?.message || String(err)}\n`);
  process.exit(1);
});

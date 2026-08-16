#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeFsVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { OpenObWorkspace } from '@okw/workspace';
import { runCli } from '../cli.js';

export async function runCliProcess(argv: string[] = process.argv.slice(2)): Promise<void> {
  let vaultPath = process.env.OPENOB_VAULT || '';
  const filteredArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault' && i + 1 < argv.length) {
      vaultPath = argv[++i];
    } else {
      filteredArgs.push(arg);
    }
  }

  if (!vaultPath) {
    vaultPath = process.cwd();
  }

  const resolvedVault = path.resolve(vaultPath);
  try {
    const stat = await fs.stat(resolvedVault);
    if (!stat.isDirectory()) {
      process.stderr.write(`Error: Vault path "${resolvedVault}" is not a directory.\n`);
      process.exit(1);
    }
  } catch (err: any) {
    process.stderr.write(
      `Error: Cannot access vault directory "${resolvedVault}": ${err.code || err.message}\n`
    );
    process.exit(1);
  }

  const vaultName = path.basename(resolvedVault) || 'local-vault';
  const storage = new NodeFsVaultStorage(resolvedVault, vaultName);
  const parser = new DefaultDocumentParser();
  const index = new MemoryDocumentIndex();

  await rebuildVaultIndex(storage, index, parser);

  const workspace = new OpenObWorkspace({
    storage,
    index,
    parser,
    vaultName,
    readOnly: true,
  });

  const result = await runCli({ workspace, args: filteredArgs });

  if (result.exitCode !== 0) {
    process.stderr.write(`${result.output}\n`);
    process.exit(result.exitCode);
  } else {
    process.stdout.write(`${result.output}\n`);
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  runCliProcess().catch((err) => {
    process.stderr.write(`Fatal error: ${err?.message || String(err)}\n`);
    process.exit(1);
  });
}

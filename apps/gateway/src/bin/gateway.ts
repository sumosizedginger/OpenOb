#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { NodeFsVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { OpenObWorkspace } from '@okw/workspace';
import { startGateway } from '../server.js';

export interface GatewayCliOptions {
  vaultPath: string;
  host: string;
  port: number;
  token?: string;
}

export function parseGatewayArgs(argv: string[]): GatewayCliOptions {
  let vaultPath = process.env.OPENOB_VAULT || '';
  let host = '127.0.0.1';
  let port = parseInt(process.env.OPENOB_PORT || '4200', 10);
  let token = process.env.OPENOB_TOKEN || undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault' && i + 1 < argv.length) {
      vaultPath = argv[++i];
    } else if (arg === '--port' && i + 1 < argv.length) {
      port = parseInt(argv[++i], 10);
    } else if (arg === '--host' && i + 1 < argv.length) {
      host = argv[++i];
    } else if (arg === '--token' && i + 1 < argv.length) {
      token = argv[++i];
    } else if (!arg.startsWith('-') && !vaultPath) {
      vaultPath = arg;
    }
  }

  if (!vaultPath) {
    vaultPath = process.cwd();
  }

  return { vaultPath, host, port, token };
}

export async function runGatewayProcess(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseGatewayArgs(argv);

  // Validate vault path
  const resolvedVault = path.resolve(options.vaultPath);
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

  // Token management
  let token = options.token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    process.stderr.write(`[OpenOb Gateway] Generated Token: ${token}\n`);
  }

  const vaultName = path.basename(resolvedVault) || 'local-vault';
  const storage = new NodeFsVaultStorage(resolvedVault, vaultName);
  const parser = new DefaultDocumentParser();
  const index = new MemoryDocumentIndex();

  process.stderr.write(`[OpenOb Gateway] Rebuilding index for vault "${vaultName}"...\n`);
  await rebuildVaultIndex(storage, index, parser);

  const workspace = new OpenObWorkspace({
    storage,
    index,
    parser,
    vaultName,
    readOnly: true,
  });

  try {
    const gateway = await startGateway({
      workspace,
      host: options.host,
      port: options.port,
      token,
    });

    process.stdout.write(
      `[OpenOb Gateway] Listening on ${gateway.url} (Vault: ${vaultName}, Read-Only: true)\n`
    );

    const shutdown = async () => {
      process.stderr.write('[OpenOb Gateway] Shutting down...\n');
      await gateway.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err: any) {
    process.stderr.write(`[OpenOb Gateway] Failed to start server: ${err.message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  runGatewayProcess().catch((err) => {
    process.stderr.write(`[OpenOb Gateway] Fatal error: ${err?.message || String(err)}\n`);
    process.exit(1);
  });
}

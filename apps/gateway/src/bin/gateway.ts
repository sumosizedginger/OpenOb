#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { NodeFsVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex, rebuildVaultIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { OpenObWorkspace } from '@okw/workspace';
import { assertLoopbackHost, startGateway } from '../server.js';

export interface GatewayCliOptions {
  vaultPath: string;
  host: string;
  port: number;
  token?: string;
  scopes: string[];
  serveWeb: boolean;
  webDistPath?: string;
  showHelp?: boolean;
}

export const GATEWAY_HELP_TEXT = `OpenOb Gateway Server

Usage:
  openob-gateway [vault-path] [options]

Options:
  --vault <path>       Path to the note vault directory (defaults to current working directory)
  --port <port>        Port to listen on (default: 4200, env: OPENOB_PORT)
  --host <ip>          Loopback IP to bind to (default: 127.0.0.1)
  --token <token>      Bearer authentication token (auto-generated if omitted)
  --scopes <scopes>    Comma-separated list of capability scopes (default: read-only)
  --serve-web          Enable static web client delivery on the gateway server
  --web-dist <path>    Custom path to web distribution assets directory
  --help, -h           Show this help message and exit

Capability Scopes:
  workspace.read         Read notes, metadata, links, backlinks, event stream, and run queries
  workspace.search       Execute keyword and tag searches across vault documents
  workspace.write        Create and update markdown notes with OCC version protection
  properties.write       Modify note frontmatter properties with OCC version protection
  workspace.rename       Rename notes and folders with atomic link reference migration
  workspace.delete       Delete notes and folders
  workspace.views.write  Create, update, and delete persisted saved views in .openob/views/

Security & Defaults:
  By default, the gateway runs in READ-ONLY mode with scopes:
    workspace.read, workspace.search

Example (Writable Gateway with Web UI):
  openob-gateway --vault ./notes --serve-web \\
    --scopes workspace.read,workspace.search,workspace.write,properties.write,workspace.rename,workspace.delete,workspace.views.write
`;

export function parseGatewayArgs(argv: string[]): GatewayCliOptions {
  let vaultPath = process.env.OPENOB_VAULT || '';
  let host = '127.0.0.1';
  let port = parseInt(process.env.OPENOB_PORT || '4200', 10);
  let token = process.env.OPENOB_TOKEN || undefined;
  let rawScopes = process.env.OPENOB_SCOPES || '';
  let serveWeb = process.env.OPENOB_SERVE_WEB === 'true' || process.env.OPENOB_SERVE_WEB === '1';
  let webDistPath = process.env.OPENOB_WEB_DIST || undefined;
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      return { vaultPath, host, port, token, scopes: [], serveWeb, webDistPath, showHelp: true };
    } else if (arg === '--vault' && i + 1 < argv.length) {
      vaultPath = argv[++i];
    } else if (arg === '--port' && i + 1 < argv.length) {
      port = parseInt(argv[++i], 10);
    } else if (arg === '--host' && i + 1 < argv.length) {
      host = argv[++i];
    } else if (arg === '--token' && i + 1 < argv.length) {
      token = argv[++i];
    } else if (arg === '--scopes' && i + 1 < argv.length) {
      rawScopes = argv[++i];
    } else if (arg === '--serve-web') {
      serveWeb = true;
    } else if (arg === '--web-dist' && i + 1 < argv.length) {
      webDistPath = argv[++i];
    } else if (!arg.startsWith('-') && !vaultPath) {
      vaultPath = arg;
    } else {
      throw new Error(`Unknown or invalid command line option: "${arg}". Use --help for usage.`);
    }
  }

  if (!vaultPath) {
    vaultPath = process.cwd();
  }

  const scopes = rawScopes
    ? rawScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['workspace.read', 'workspace.search'];

  return { vaultPath, host, port, token, scopes, serveWeb, webDistPath, showHelp };
}

export async function runGatewayProcess(argv: string[] = process.argv.slice(2)): Promise<void> {
  let options: GatewayCliOptions;
  try {
    options = parseGatewayArgs(argv);
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  if (options.showHelp) {
    process.stdout.write(GATEWAY_HELP_TEXT);
    process.exit(0);
  }

  // Validate host loopback binding
  try {
    assertLoopbackHost(options.host);
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

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

  const isReadOnly =
    !options.scopes.includes('workspace.write') &&
    !options.scopes.includes('properties.write') &&
    !options.scopes.includes('workspace.views.write');

  const workspace = new OpenObWorkspace({
    storage,
    index,
    parser,
    vaultName,
    readOnly: isReadOnly,
  });

  try {
    const gateway = await startGateway({
      workspace,
      host: options.host,
      port: options.port,
      token,
      scopes: options.scopes,
      serveWeb: options.serveWeb,
      webDistPath: options.webDistPath,
    });

    const webSuffix = options.serveWeb ? ' [Web UI Enabled]' : '';
    process.stdout.write(
      `[OpenOb Gateway] Listening on ${gateway.url}${webSuffix} (Vault: ${vaultName}, Read-Only: ${isReadOnly}, Scopes: [${options.scopes.join(', ')}])\n`
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

import { fileURLToPath } from 'node:url';

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  runGatewayProcess().catch((err) => {
    process.stderr.write(`[OpenOb Gateway] Fatal error: ${err?.message || String(err)}\n`);
    process.exit(1);
  });
}

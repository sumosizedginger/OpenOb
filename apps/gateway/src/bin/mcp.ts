#!/usr/bin/env node

import process from 'node:process';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createOpenObMcpServer } from '../mcp-server.js';
import { SafeStdioServerTransport } from '../stdio-transport.js';

const MCP_HELP_TEXT = `OpenOb MCP Server (Live Stdio Transport)

Usage:
  openob-mcp [--url <url>] [--token <token>] [--client-id <id>]
  openob-mcp --help

Environment Variables:
  OPENOB_URL        Gateway REST URL (default: http://127.0.0.1:4512)
  OPENOB_TOKEN      Bearer authentication token for the OpenOb Gateway
  OPENOB_CLIENT_ID  Client identifier for audit logs (default: openob-mcp)

Description:
  Runs the Model Context Protocol (MCP) server over standard input/output (stdio).
  Exposes the 11 OpenOb workspace tools to external AI agents and IDEs.
  All operations route exclusively through the running OpenOb Gateway REST API.
`;

function parseArgs(args: string[]): {
  url: string;
  token?: string;
  clientId: string;
  help: boolean;
} {
  let url = process.env.OPENOB_URL || 'http://127.0.0.1:4512';
  let token = process.env.OPENOB_TOKEN;
  let clientId = process.env.OPENOB_CLIENT_ID || 'openob-mcp';
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h' || a === 'help') {
      help = true;
    } else if (a === '--url' && i + 1 < args.length) {
      url = args[++i];
    } else if (a === '--token' && i + 1 < args.length) {
      token = args[++i];
    } else if (a === '--client-id' && i + 1 < args.length) {
      clientId = args[++i];
    }
  }

  return { url, token, clientId, help };
}

async function main() {
  const { url, token, clientId, help } = parseArgs(process.argv.slice(2));

  if (help) {
    process.stdout.write(MCP_HELP_TEXT);
    process.exit(0);
  }

  // Diagnostic logs strictly go to stderr so stdout remains 100% pure JSON-RPC
  process.stderr.write(
    `[openob-mcp] Starting stdio MCP server targeting gateway: ${url} (clientId: ${clientId})\n`
  );

  const server = createOpenObMcpServer({
    url,
    token,
    clientId,
  });

  const transport = new SafeStdioServerTransport(process.stdin, process.stdout);
  const session = serveStdio(() => server, {
    transport,
    onerror: (err) => {
      process.stderr.write(`[openob-mcp] Transport error: ${err?.message || String(err)}\n`);
    },
  });

  const shutdown = async () => {
    try {
      await session.close();
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[openob-mcp] Fatal error: ${err?.message || String(err)}\n`);
  process.exit(1);
});

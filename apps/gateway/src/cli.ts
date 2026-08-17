import { VaultEntry } from '@okw/core';
import {
  BacklinkDTO,
  NoteReadResult,
  OpenObWorkspace,
  SearchResultDTO,
  SearchResultMatch,
  WorkspaceInfo,
} from '@okw/workspace';

export interface CliOptions {
  readonly workspace?: OpenObWorkspace;
  readonly url?: string;
  readonly token?: string;
  readonly args: string[];
}

export const CLI_HELP_TEXT = `OpenOb Local CLI (Read-Only)

Usage:
  openob info [--json] [--url <url>] [--token <token>]
  openob list [subpath] [--json] [--url <url>] [--token <token>]
  openob read <path> [--json] [--url <url>] [--token <token>]
  openob search <query> [--json] [--url <url>] [--token <token>]
  openob backlinks <path> [--json] [--url <url>] [--token <token>]
  openob help
`;

export function handleHelpOrUnknown(
  command?: string,
  isJson?: boolean
): { exitCode: number; output: string } {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { exitCode: 0, output: CLI_HELP_TEXT };
  }
  const errorMsg = isJson
    ? JSON.stringify({ error: `Unknown command: "${command}"` }, null, 2)
    : `Error: Unknown command "${command}".\n\n${CLI_HELP_TEXT}`;
  return { exitCode: 1, output: errorMsg };
}

export async function runCli(options: CliOptions): Promise<{ exitCode: number; output: string }> {
  const { workspace, args } = options;
  const isJson = args.includes('--json');
  const filteredArgs = args.filter((a) => a !== '--json');

  // If a direct in-memory workspace was provided, run against it (e.g. unit tests)
  if (workspace) {
    return runCliDirect(workspace, filteredArgs, isJson);
  }

  // Otherwise, connect via REST client to the running gateway (Gateway-Managed Mode)
  const baseUrl = options.url || process.env.OPENOB_URL || 'http://127.0.0.1:4200';
  const token = options.token || process.env.OPENOB_TOKEN;

  return runCliRemote(baseUrl, token, filteredArgs, isJson);
}

async function runCliDirect(
  workspace: OpenObWorkspace,
  args: string[],
  isJson: boolean
): Promise<{ exitCode: number; output: string }> {
  const command = args[0];

  try {
    switch (command) {
      case 'info': {
        const info = await workspace.getWorkspaceInfo();
        const output = isJson
          ? JSON.stringify(info, null, 2)
          : `Vault: ${info.name}\nNotes: ${info.noteCount}\nStorage: ${info.storageType}\nAPI: ${info.apiVersion}\nRead-Only: ${info.readOnly}`;
        return { exitCode: 0, output };
      }

      case 'list': {
        const subPath = args[1] ?? '';
        const entries = await workspace.listEntries(subPath);
        const output = isJson
          ? JSON.stringify(entries, null, 2)
          : entries
              .map((e: VaultEntry) => `${e.isDirectory ? '[DIR] ' : '      '}${e.path}`)
              .join('\n');
        return { exitCode: 0, output };
      }

      case 'read': {
        const path = args[1];
        if (!path) {
          return { exitCode: 1, output: 'Error: Missing path argument. Usage: openob read <path>' };
        }
        const note = await workspace.readNote(path);
        const output = isJson ? JSON.stringify(note, null, 2) : note.textContent;
        return { exitCode: 0, output };
      }

      case 'search': {
        const query = args[1];
        if (!query) {
          return {
            exitCode: 1,
            output: 'Error: Missing query argument. Usage: openob search <query>',
          };
        }
        const result = await workspace.search({ query });
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Found ${result.total} matches for "${query}":\n` +
            result.matches.map((m: SearchResultMatch) => `  - ${m.path}: ${m.title}`).join('\n');
        return { exitCode: 0, output };
      }

      case 'backlinks': {
        const path = args[1];
        if (!path) {
          return {
            exitCode: 1,
            output: 'Error: Missing path argument. Usage: openob backlinks <path>',
          };
        }
        const backlinks = await workspace.getBacklinks(path);
        const output = isJson
          ? JSON.stringify(backlinks, null, 2)
          : `Backlinks to ${path} (${backlinks.length}):\n` +
            backlinks
              .map((b: BacklinkDTO) => `  - from ${b.sourcePath} (line ${b.line}): ${b.rawLink}`)
              .join('\n');
        return { exitCode: 0, output };
      }

      case 'help':
      case '--help':
      case '-h':
      default: {
        return handleHelpOrUnknown(command, isJson);
      }
    }
  } catch (err: any) {
    const errorMsg = isJson
      ? JSON.stringify({ error: err?.message || String(err) }, null, 2)
      : `Error: ${err?.message || String(err)}`;
    return { exitCode: 1, output: errorMsg };
  }
}

async function runCliRemote(
  baseUrl: string,
  token: string | undefined,
  args: string[],
  isJson: boolean
): Promise<{ exitCode: number; output: string }> {
  const command = args[0];

  // If command is help or unknown, resolve immediately without needing an HTTP request
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return handleHelpOrUnknown(command, isJson);
  }

  const validCommands = new Set(['info', 'list', 'read', 'search', 'backlinks']);
  if (!validCommands.has(command)) {
    return handleHelpOrUnknown(command, isJson);
  }

  const headers: Record<string, string> = {
    'User-Agent': 'openob-cli/0.1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');

  async function remoteFetch(apiPath: string): Promise<any> {
    const targetUrl = `${cleanBase}${apiPath}`;
    let res: Response;
    try {
      res = await fetch(targetUrl, { headers });
    } catch (err: any) {
      throw new Error(
        `Unable to connect to OpenOb Gateway at "${cleanBase}". Is the gateway running?\n(Start it with: npx openob-gateway <vault-path>)`,
        { cause: err }
      );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(errMsg);
    }
    return data;
  }

  try {
    switch (command) {
      case 'info': {
        const info: WorkspaceInfo = await remoteFetch('/api/v1/workspace');
        const output = isJson
          ? JSON.stringify(info, null, 2)
          : `Vault: ${info.name}\nNotes: ${info.noteCount}\nStorage: ${info.storageType}\nAPI: ${info.apiVersion}\nRead-Only: ${info.readOnly}`;
        return { exitCode: 0, output };
      }

      case 'list': {
        const subPath = args[1] ?? '';
        const queryParam = subPath ? `?path=${encodeURIComponent(subPath)}` : '';
        const entries: VaultEntry[] = await remoteFetch(`/api/v1/entries${queryParam}`);
        const output = isJson
          ? JSON.stringify(entries, null, 2)
          : entries
              .map((e: VaultEntry) => `${e.isDirectory ? '[DIR] ' : '      '}${e.path}`)
              .join('\n');
        return { exitCode: 0, output };
      }

      case 'read': {
        const path = args[1];
        if (!path) {
          return { exitCode: 1, output: 'Error: Missing path argument. Usage: openob read <path>' };
        }
        const note: NoteReadResult = await remoteFetch(`/api/v1/notes/${encodeURIComponent(path)}`);
        const output = isJson ? JSON.stringify(note, null, 2) : note.textContent;
        return { exitCode: 0, output };
      }

      case 'search': {
        const query = args[1];
        if (!query) {
          return {
            exitCode: 1,
            output: 'Error: Missing query argument. Usage: openob search <query>',
          };
        }
        const result: SearchResultDTO = await remoteFetch(
          `/api/v1/search?q=${encodeURIComponent(query)}`
        );
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Found ${result.total} matches for "${query}":\n` +
            result.matches.map((m: SearchResultMatch) => `  - ${m.path}: ${m.title}`).join('\n');
        return { exitCode: 0, output };
      }

      case 'backlinks': {
        const path = args[1];
        if (!path) {
          return {
            exitCode: 1,
            output: 'Error: Missing path argument. Usage: openob backlinks <path>',
          };
        }
        const backlinks: BacklinkDTO[] = await remoteFetch(
          `/api/v1/notes/${encodeURIComponent(path)}/backlinks`
        );
        const output = isJson
          ? JSON.stringify(backlinks, null, 2)
          : `Backlinks to ${path} (${backlinks.length}):\n` +
            backlinks
              .map((b: BacklinkDTO) => `  - from ${b.sourcePath} (line ${b.line}): ${b.rawLink}`)
              .join('\n');
        return { exitCode: 0, output };
      }

      default: {
        return handleHelpOrUnknown(command, isJson);
      }
    }
  } catch (err: any) {
    const errorMsg = isJson
      ? JSON.stringify({ error: err?.message || String(err) }, null, 2)
      : `Error: ${err?.message || String(err)}`;
    return { exitCode: 1, output: errorMsg };
  }
}

import { VaultEntry } from '@okw/core';
import {
  BacklinkDTO,
  MutationResultDTO,
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
  readonly stdinContent?: string;
}

export const CLI_HELP_TEXT = `OpenOb Local CLI

Usage:
  openob info [--json] [--url <url>] [--token <token>]
  openob list [subpath] [--json] [--url <url>] [--token <token>]
  openob read <path> [--json] [--url <url>] [--token <token>]
  openob search <query> [--json] [--url <url>] [--token <token>]
  openob backlinks <path> [--json] [--url <url>] [--token <token>]
  openob create <path> [--content <content>] [--stdin] [--json] [--url <url>] [--token <token>]
  openob update <path> --expected-version <token> [--content <content>] [--stdin] [--json] [--url <url>] [--token <token>]
  openob set-property <path> <key> [value] --expected-version <token> [--json] [--url <url>] [--token <token>]
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

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export async function runCli(options: CliOptions): Promise<{ exitCode: number; output: string }> {
  const { workspace, args } = options;
  const isJson = args.includes('--json');

  // Extract common flags
  let expectedVersion: string | undefined;
  let explicitContent: string | undefined;
  const isStdin = args.includes('--stdin');
  let explicitUrl: string | undefined;
  let explicitToken: string | undefined;

  const positionalArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json' || a === '--stdin') {
      continue;
    } else if (a === '--expected-version' && i + 1 < args.length) {
      expectedVersion = args[++i];
    } else if (a === '--content' && i + 1 < args.length) {
      explicitContent = args[++i];
    } else if (a === '--url' && i + 1 < args.length) {
      explicitUrl = args[++i];
    } else if (a === '--token' && i + 1 < args.length) {
      explicitToken = args[++i];
    } else {
      positionalArgs.push(a);
    }
  }

  let content = explicitContent;
  if (isStdin) {
    content = options.stdinContent !== undefined ? options.stdinContent : await readStdin();
  }

  // If a direct in-memory workspace was provided, run against it (e.g. unit tests)
  if (workspace) {
    return runCliDirect(workspace, positionalArgs, isJson, expectedVersion, content);
  }

  // Otherwise, connect via REST client to the running gateway (Gateway-Managed Mode)
  const baseUrl = explicitUrl || options.url || process.env.OPENOB_URL || 'http://127.0.0.1:4200';
  const token = explicitToken || options.token || process.env.OPENOB_TOKEN;

  return runCliRemote(baseUrl, token, positionalArgs, isJson, expectedVersion, content);
}

async function runCliDirect(
  workspace: OpenObWorkspace,
  args: string[],
  isJson: boolean,
  expectedVersion?: string,
  content?: string
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

      case 'create': {
        const path = args[1];
        if (!path) {
          return {
            exitCode: 1,
            output:
              'Error: Missing path argument. Usage: openob create <path> [--content <content>] [--stdin]',
          };
        }
        const result = await workspace.createNote({
          path,
          content: content ?? '',
        });
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Created note: ${result.path} (version: ${result.currentVersion.token})`;
        return { exitCode: 0, output };
      }

      case 'update': {
        const path = args[1];
        if (!path) {
          return {
            exitCode: 1,
            output:
              'Error: Missing path argument. Usage: openob update <path> --expected-version <token> [--content <content>] [--stdin]',
          };
        }
        if (!expectedVersion) {
          return {
            exitCode: 1,
            output: 'Error: Missing required --expected-version <token> flag for note update',
          };
        }
        const result = await workspace.updateNote({
          path,
          content: content ?? '',
          expectedVersion: { token: expectedVersion },
        });
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Updated note: ${result.path} (version: ${result.currentVersion.token})`;
        return { exitCode: 0, output };
      }

      case 'set-property': {
        const path = args[1];
        const key = args[2];
        const rawVal = args[3];
        if (!path || !key || path.startsWith('-') || key.startsWith('-')) {
          return {
            exitCode: 1,
            output:
              'Error: Invalid or missing arguments. Usage: openob set-property <path> <key> [value] --expected-version <token>',
          };
        }
        if (!expectedVersion) {
          return {
            exitCode: 1,
            output: 'Error: Missing required --expected-version <token> flag for property mutation',
          };
        }

        let parsedVal: unknown = rawVal;
        if (rawVal === undefined || rawVal === 'null') {
          parsedVal = null;
        } else {
          try {
            parsedVal = JSON.parse(rawVal);
          } catch {
            parsedVal = rawVal;
          }
        }

        const result = await workspace.setProperty({
          path,
          key,
          value: parsedVal,
          expectedVersion: { token: expectedVersion },
        });
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Set property "${key}" on ${result.path} (version: ${result.currentVersion.token})`;
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
  isJson: boolean,
  expectedVersion?: string,
  content?: string
): Promise<{ exitCode: number; output: string }> {
  const command = args[0];

  // If command is help or unknown, resolve immediately without needing an HTTP request
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return handleHelpOrUnknown(command, isJson);
  }

  const validCommands = new Set([
    'info',
    'list',
    'read',
    'search',
    'backlinks',
    'create',
    'update',
    'set-property',
  ]);
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

  async function remoteFetch(
    apiPath: string,
    fetchMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
    body?: any
  ): Promise<any> {
    const targetUrl = `${cleanBase}${apiPath}`;
    const reqHeaders: Record<string, string> = { ...headers };
    let reqBody: string | undefined;

    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: fetchMethod,
        headers: reqHeaders,
        body: reqBody,
      });
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

      case 'create': {
        const path = args[1];
        if (!path) {
          return {
            exitCode: 1,
            output:
              'Error: Missing path argument. Usage: openob create <path> [--content <content>] [--stdin]',
          };
        }
        const result: MutationResultDTO = await remoteFetch('/api/v1/notes', 'POST', {
          path,
          content: content ?? '',
        });
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Created note: ${result.path} (version: ${result.currentVersion.token})`;
        return { exitCode: 0, output };
      }

      case 'update': {
        const path = args[1];
        if (!path) {
          return {
            exitCode: 1,
            output:
              'Error: Missing path argument. Usage: openob update <path> --expected-version <token> [--content <content>] [--stdin]',
          };
        }
        if (!expectedVersion) {
          return {
            exitCode: 1,
            output: 'Error: Missing required --expected-version <token> flag for note update',
          };
        }
        const result: MutationResultDTO = await remoteFetch(
          `/api/v1/notes/${encodeURIComponent(path)}`,
          'PUT',
          {
            content: content ?? '',
            expectedVersion: { token: expectedVersion },
          }
        );
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Updated note: ${result.path} (version: ${result.currentVersion.token})`;
        return { exitCode: 0, output };
      }

      case 'set-property': {
        const path = args[1];
        const key = args[2];
        const rawVal = args[3];
        if (!path || !key || path.startsWith('-') || key.startsWith('-')) {
          return {
            exitCode: 1,
            output:
              'Error: Invalid or missing arguments. Usage: openob set-property <path> <key> [value] --expected-version <token>',
          };
        }
        if (!expectedVersion) {
          return {
            exitCode: 1,
            output: 'Error: Missing required --expected-version <token> flag for property mutation',
          };
        }

        let parsedVal: unknown = rawVal;
        if (rawVal === undefined || rawVal === 'null') {
          parsedVal = null;
        } else {
          try {
            parsedVal = JSON.parse(rawVal);
          } catch {
            parsedVal = rawVal;
          }
        }

        const result: MutationResultDTO = await remoteFetch(
          `/api/v1/notes/${encodeURIComponent(path)}/properties`,
          'PATCH',
          {
            key,
            value: parsedVal,
            expectedVersion: { token: expectedVersion },
          }
        );
        const output = isJson
          ? JSON.stringify(result, null, 2)
          : `Set property "${key}" on ${result.path} (version: ${result.currentVersion.token})`;
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

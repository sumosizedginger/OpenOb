import { VaultEntry } from '@okw/core';
import { BacklinkDTO, OpenObWorkspace, SearchResultMatch } from '@okw/workspace';

export interface CliOptions {
  readonly workspace: OpenObWorkspace;
  readonly args: string[];
}

export async function runCli(options: CliOptions): Promise<{ exitCode: number; output: string }> {
  const { workspace, args } = options;
  const isJson = args.includes('--json');
  const filteredArgs = args.filter((a) => a !== '--json');

  const command = filteredArgs[0];

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
        const subPath = filteredArgs[1] ?? '';
        const entries = await workspace.listEntries(subPath);
        const output = isJson
          ? JSON.stringify(entries, null, 2)
          : entries
              .map((e: VaultEntry) => `${e.isDirectory ? '[DIR] ' : '      '}${e.path}`)
              .join('\n');
        return { exitCode: 0, output };
      }

      case 'read': {
        const path = filteredArgs[1];
        if (!path) {
          return { exitCode: 1, output: 'Error: Missing path argument. Usage: openob read <path>' };
        }
        const note = await workspace.readNote(path);
        const output = isJson ? JSON.stringify(note, null, 2) : note.textContent;
        return { exitCode: 0, output };
      }

      case 'search': {
        const query = filteredArgs[1];
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
        const path = filteredArgs[1];
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
        const helpText = `OpenOb Local CLI (Read-Only)

Usage:
  openob info [--json]
  openob list [subpath] [--json]
  openob read <path> [--json]
  openob search <query> [--json]
  openob backlinks <path> [--json]
`;
        return { exitCode: command ? 1 : 0, output: helpText };
      }
    }
  } catch (err: any) {
    const errorMsg = isJson
      ? JSON.stringify({ error: err?.message || String(err) }, null, 2)
      : `Error: ${err?.message || String(err)}`;
    return { exitCode: 1, output: errorMsg };
  }
}

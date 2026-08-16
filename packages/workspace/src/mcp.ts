import { toApiError } from './errors.js';
import { ClientContext } from './types.js';
import { OpenObWorkspace } from './workspace.js';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, any>;
    readonly required?: string[];
  };
}

export interface McpToolResponse {
  readonly content: Array<{
    readonly type: 'text';
    readonly text: string;
  }>;
  readonly isError?: boolean;
}

/**
 * Protocol-neutral declarations of read-only MCP tools backed by OpenObWorkspace.
 */
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'openob_workspace_info',
    description: 'Retrieve summary information, capabilities, and metrics about the OpenOb vault.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'openob_list_entries',
    description: 'List files and folders within a vault directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional subfolder path relative to vault root. Defaults to root.',
        },
      },
    },
  },
  {
    name: 'openob_read_note',
    description:
      'Read a Markdown note including its parsed headings, wikilinks, YAML frontmatter properties, and raw text.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the note (e.g. "Notes/Project.md").',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'openob_search',
    description: 'Execute lexical and tag search across all documents in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tag filters.',
        },
        pathPrefix: {
          type: 'string',
          description: 'Optional folder path prefix filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'openob_get_backlinks',
    description: 'Retrieve all incoming backlinks pointing to a specific note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the target note.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'openob_get_properties',
    description: 'Retrieve structured YAML frontmatter properties for a note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the note.',
        },
      },
      required: ['path'],
    },
  },
];

/**
 * Handles an MCP tool call by delegating directly to the underlying OpenObWorkspace instance.
 */
export async function handleMcpToolCall(
  workspace: OpenObWorkspace,
  toolName: string,
  args: Record<string, any> = {},
  context?: ClientContext
): Promise<McpToolResponse> {
  try {
    switch (toolName) {
      case 'openob_workspace_info': {
        const info = await workspace.getWorkspaceInfo(context);
        return {
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
        };
      }

      case 'openob_list_entries': {
        const entries = await workspace.listEntries(args.path ?? '', context);
        return {
          content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
        };
      }

      case 'openob_read_note': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        const result = await workspace.readNote(args.path, context);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'openob_search': {
        if (!args.query || typeof args.query !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "query"' }],
            isError: true,
          };
        }
        const result = await workspace.search(
          {
            query: args.query,
            tags: args.tags,
            pathPrefix: args.pathPrefix,
            limit: args.limit,
          },
          context
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'openob_get_backlinks': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        const backlinks = await workspace.getBacklinks(args.path, context);
        return {
          content: [{ type: 'text', text: JSON.stringify(backlinks, null, 2) }],
        };
      }

      case 'openob_get_properties': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        const props = await workspace.getProperties(args.path, context);
        return {
          content: [{ type: 'text', text: JSON.stringify(props, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: "${toolName}"` }],
          isError: true,
        };
    }
  } catch (err) {
    const apiErr = toApiError(err);
    return {
      content: [{ type: 'text', text: JSON.stringify(apiErr.body, null, 2) }],
      isError: true,
    };
  }
}

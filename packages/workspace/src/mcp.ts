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
 * Protocol-neutral declarations of MCP tools backed by OpenObWorkspace.
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
  {
    name: 'openob_create_note',
    description: 'Create a new Markdown note in the vault with optional content and properties.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path for the new note (e.g. "Notes/NewIdea.md").',
        },
        content: {
          type: 'string',
          description: 'Initial body content for the note.',
        },
        properties: {
          type: 'object',
          description: 'Optional YAML frontmatter key-value properties.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'openob_update_note',
    description:
      'Update the body content of an existing note using strict optimistic concurrency control.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the note.',
        },
        content: {
          type: 'string',
          description: 'New body content for the note.',
        },
        expectedVersion: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Version token previously returned by readNote.',
            },
          },
          required: ['token'],
          description: 'Expected version token for concurrency validation.',
        },
      },
      required: ['path', 'content', 'expectedVersion'],
    },
  },
  {
    name: 'openob_set_property',
    description:
      'Set or delete a frontmatter property on a note using optimistic concurrency control.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the note.',
        },
        key: {
          type: 'string',
          description: 'Property key to set or remove.',
        },
        value: {
          description: 'Property value to assign, or null to remove the property.',
        },
        expectedVersion: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Version token previously returned by readNote.',
            },
          },
          required: ['token'],
          description: 'Expected version token for concurrency validation.',
        },
      },
      required: ['path', 'key', 'expectedVersion'],
    },
  },
  {
    name: 'openob_rename_note',
    description:
      'Safely rename a Markdown note and refactor incoming wikilinks across the vault using strict optimistic concurrency control.',
    inputSchema: {
      type: 'object',
      properties: {
        oldPath: {
          type: 'string',
          description: 'Current vault-relative path to the note (e.g. "Notes/OldName.md").',
        },
        newPath: {
          type: 'string',
          description: 'New vault-relative target path (e.g. "Notes/NewName.md").',
        },
        expectedVersion: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Version token previously returned by readNote.',
            },
          },
          required: ['token'],
          description:
            'Expected version token of the source note for optimistic concurrency control.',
        },
        updateLinks: {
          type: 'boolean',
          description: 'Whether to refactor inbound wikilinks across the vault (default: true).',
        },
      },
      required: ['oldPath', 'newPath', 'expectedVersion'],
    },
  },
  {
    name: 'openob_delete_note',
    description:
      'Safely delete a Markdown note from the vault using strict optimistic concurrency control.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path to the note to delete (e.g. "Notes/OldNote.md").',
        },
        expectedVersion: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Version token previously returned by readNote.',
            },
          },
          required: ['token'],
          description: 'Expected version token of the note for optimistic concurrency control.',
        },
      },
      required: ['path', 'expectedVersion'],
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

      case 'openob_create_note': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        const res = await workspace.createNote(
          {
            path: args.path,
            content: args.content,
            properties: args.properties,
          },
          context
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'openob_update_note': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        if (typeof args.content !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "content"' }],
            isError: true,
          };
        }
        if (!args.expectedVersion || typeof args.expectedVersion.token !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Missing required argument: "expectedVersion" with valid "token"',
              },
            ],
            isError: true,
          };
        }
        const res = await workspace.updateNote(
          {
            path: args.path,
            content: args.content,
            expectedVersion: args.expectedVersion,
          },
          context
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'openob_set_property': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        if (typeof args.key !== 'string' || !args.key.trim()) {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "key"' }],
            isError: true,
          };
        }
        if (!args.expectedVersion || typeof args.expectedVersion.token !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Missing required argument: "expectedVersion" with valid "token"',
              },
            ],
            isError: true,
          };
        }
        const res = await workspace.setProperty(
          {
            path: args.path,
            key: args.key,
            value: args.value,
            expectedVersion: args.expectedVersion,
          },
          context
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'openob_rename_note': {
        if (!args.oldPath || typeof args.oldPath !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "oldPath"' }],
            isError: true,
          };
        }
        if (!args.newPath || typeof args.newPath !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "newPath"' }],
            isError: true,
          };
        }
        if (!args.expectedVersion || typeof args.expectedVersion.token !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Missing required argument: "expectedVersion" with valid "token"',
              },
            ],
            isError: true,
          };
        }
        const res = await workspace.renameNote(
          {
            oldPath: args.oldPath,
            newPath: args.newPath,
            expectedVersion: args.expectedVersion,
            updateLinks: args.updateLinks,
          },
          context
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'openob_delete_note': {
        if (!args.path || typeof args.path !== 'string') {
          return {
            content: [{ type: 'text', text: 'Missing required argument: "path"' }],
            isError: true,
          };
        }
        if (!args.expectedVersion || typeof args.expectedVersion.token !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Missing required argument: "expectedVersion" with valid "token"',
              },
            ],
            isError: true,
          };
        }
        const res = await workspace.deleteNote(
          {
            path: args.path,
            expectedVersion: args.expectedVersion,
          },
          context
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
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

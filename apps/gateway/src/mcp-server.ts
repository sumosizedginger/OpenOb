import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GatewayClientOptions, GatewayError, OpenObGatewayClient } from './client.js';

function formatToolError(err: unknown) {
  const status = err instanceof GatewayError ? err.status : 500;
  const code = err instanceof GatewayError ? err.code : 'INTERNAL_ERROR';
  const errorPayload = {
    error: {
      status,
      code,
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof GatewayError && err.details ? { details: err.details } : {}),
    },
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(errorPayload, null, 2) }],
    isError: true,
  };
}

/**
 * Creates and configures an MCP Server that exposes OpenOb tools.
 * All operations are delegated exclusively to the OpenOb Gateway REST API.
 * The MCP server holds NO DIRECT VAULT STORAGE OR INDEX ACCESS.
 */
export function createOpenObMcpServer(options: GatewayClientOptions): McpServer {
  const client = new OpenObGatewayClient(options);
  const server = new McpServer({
    name: 'openob-mcp',
    version: '0.1.0',
  });

  // 1. openob_workspace_info
  server.registerTool(
    'openob_workspace_info',
    {
      description:
        'Retrieve summary information, capabilities, and metrics about the OpenOb vault.',
    },
    async () => {
      try {
        const info = await client.getWorkspaceInfo();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 2. openob_list_entries
  server.registerTool(
    'openob_list_entries',
    {
      description: 'List files and folders within a vault directory.',
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Optional subfolder path relative to vault root. Defaults to root.'),
      },
    },
    async (args) => {
      try {
        const entries = await client.listEntries(args.path);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 3. openob_read_note
  server.registerTool(
    'openob_read_note',
    {
      description:
        'Read a Markdown note including its parsed headings, wikilinks, YAML frontmatter properties, and raw text.',
      inputSchema: {
        path: z.string().describe('Vault-relative path to the note (e.g. "Notes/Project.md").'),
      },
    },
    async (args) => {
      try {
        const note = await client.readNote(args.path);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 4. openob_search
  server.registerTool(
    'openob_search',
    {
      description: 'Execute lexical and tag search across all documents in the vault.',
      inputSchema: {
        query: z.string().describe('Search query string.'),
        tags: z.array(z.string()).optional().describe('Optional tag filters.'),
        pathPrefix: z.string().optional().describe('Optional folder path prefix filter.'),
        limit: z.number().optional().describe('Maximum number of results (default: 50).'),
      },
    },
    async (args) => {
      try {
        const result = await client.search({
          query: args.query,
          tags: args.tags,
          pathPrefix: args.pathPrefix,
          limit: args.limit,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 5. openob_get_backlinks
  server.registerTool(
    'openob_get_backlinks',
    {
      description: 'Retrieve all incoming backlinks pointing to a specific note.',
      inputSchema: {
        path: z.string().describe('Vault-relative path to the target note.'),
      },
    },
    async (args) => {
      try {
        const backlinks = await client.getBacklinks(args.path);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(backlinks, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 6. openob_get_properties
  server.registerTool(
    'openob_get_properties',
    {
      description: 'Retrieve structured YAML frontmatter properties for a note.',
      inputSchema: {
        path: z.string().describe('Vault-relative path to the note.'),
      },
    },
    async (args) => {
      try {
        const props = await client.getProperties(args.path);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(props, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 7. openob_create_note
  server.registerTool(
    'openob_create_note',
    {
      description: 'Create a new Markdown note in the vault with optional content and properties.',
      inputSchema: {
        path: z
          .string()
          .describe('Vault-relative path for the new note (e.g. "Notes/NewIdea.md").'),
        content: z
          .string()
          .max(10 * 1024 * 1024)
          .optional()
          .describe('Initial body content for the note.'),
        properties: z
          .record(z.string(), z.any())
          .optional()
          .describe('Optional YAML frontmatter key-value properties.'),
      },
    },
    async (args) => {
      try {
        const res = await client.createNote({
          path: args.path,
          content: args.content,
          properties: args.properties,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 8. openob_update_note
  server.registerTool(
    'openob_update_note',
    {
      description:
        'Update the body content of an existing note using strict optimistic concurrency control. Note: this replaces the entire file content; existing frontmatter properties will be overwritten unless explicitly included in content. Use openob_set_property for individual property modifications.',
      inputSchema: {
        path: z.string().describe('Vault-relative path to the note.'),
        content: z
          .string()
          .max(10 * 1024 * 1024)
          .describe('New body content for the note.'),
        expectedVersion: z
          .object({
            token: z.string().describe('Version token previously returned by readNote.'),
          })
          .describe('Expected version token for concurrency validation.'),
      },
    },
    async (args) => {
      try {
        const res = await client.updateNote({
          path: args.path,
          content: args.content,
          expectedVersion: args.expectedVersion,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 9. openob_set_property
  server.registerTool(
    'openob_set_property',
    {
      description:
        'Set or delete a frontmatter property on a note using optimistic concurrency control.',
      inputSchema: {
        path: z.string().describe('Vault-relative path to the note.'),
        key: z.string().describe('Property key to set or remove.'),
        value: z
          .any()
          .optional()
          .describe('Property value to assign, or null to remove the property.'),
        expectedVersion: z
          .object({
            token: z.string().describe('Version token previously returned by readNote.'),
          })
          .describe('Expected version token for concurrency validation.'),
      },
    },
    async (args) => {
      try {
        const res = await client.setProperty({
          path: args.path,
          key: args.key,
          value: args.value,
          expectedVersion: args.expectedVersion,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 10. openob_rename_note
  server.registerTool(
    'openob_rename_note',
    {
      description:
        'Safely rename a Markdown note and refactor incoming wikilinks across the vault using strict optimistic concurrency control.',
      inputSchema: {
        oldPath: z
          .string()
          .describe('Current vault-relative path to the note (e.g. "Notes/OldName.md").'),
        newPath: z.string().describe('New vault-relative target path (e.g. "Notes/NewName.md").'),
        expectedVersion: z
          .object({
            token: z.string().describe('Version token previously returned by readNote.'),
          })
          .describe(
            'Expected version token of the source note for optimistic concurrency control.'
          ),
        updateLinks: z
          .boolean()
          .optional()
          .describe('Whether to refactor inbound wikilinks across the vault (default: true).'),
      },
    },
    async (args) => {
      try {
        const res = await client.renameNote({
          oldPath: args.oldPath,
          newPath: args.newPath,
          expectedVersion: args.expectedVersion,
          updateLinks: args.updateLinks,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  // 11. openob_delete_note
  server.registerTool(
    'openob_delete_note',
    {
      description:
        'Safely delete a Markdown note from the vault using strict optimistic concurrency control.',
      inputSchema: {
        path: z
          .string()
          .describe('Vault-relative path to the note to delete (e.g. "Notes/OldNote.md").'),
        expectedVersion: z
          .object({
            token: z.string().describe('Version token previously returned by readNote.'),
          })
          .describe('Expected version token of the note for optimistic concurrency control.'),
      },
    },
    async (args) => {
      try {
        const res = await client.deleteNote({
          path: args.path,
          expectedVersion: args.expectedVersion,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    }
  );

  return server;
}

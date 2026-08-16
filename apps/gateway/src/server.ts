import http from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { ClientContext, OpenObWorkspace, toApiError, UnauthorizedError } from '@okw/workspace';

export interface GatewayOptions {
  readonly workspace: OpenObWorkspace;
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
}

export interface RunningGateway {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly server: http.Server;
  stop(): Promise<void>;
}

/**
 * Creates and starts a local loopback gateway HTTP server for OpenOb.
 */
export function createGatewayServer(options: GatewayOptions): http.Server {
  const { workspace, token } = options;

  const server = http.createServer(async (req, res) => {
    // Standard secure JSON headers
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    const reqUrl = req.url ?? '/';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(reqUrl, `http://${req.headers.host ?? '127.0.0.1'}`);
    } catch {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          code: 'INVALID_REQUEST',
          message: 'Malformed request URL',
        })
      );
      return;
    }

    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();

    // 1. Health check is always public and unauthenticated
    if (pathname === '/health' && method === 'GET') {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          status: 'ok',
          version: '0.1.0',
          readOnly: true,
          vault: workspace.vaultName,
        })
      );
      return;
    }

    // 2. Authentication check for /api/v1/* routes
    if (token) {
      const authHeader = req.headers['authorization'];
      const customTokenHeader = req.headers['x-openob-token'];

      let clientToken: string | undefined;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        clientToken = authHeader.slice(7).trim();
      } else if (typeof customTokenHeader === 'string') {
        clientToken = customTokenHeader.trim();
      }

      if (!clientToken || clientToken !== token) {
        const err = toApiError(new UnauthorizedError());
        res.statusCode = err.status;
        res.end(JSON.stringify(err.body));
        return;
      }
    }

    // Extract client identity context
    const clientIdHeader = req.headers['x-openob-client-id'];
    const clientContext: ClientContext = {
      clientId: typeof clientIdHeader === 'string' ? clientIdHeader : undefined,
      requestId:
        (typeof req.headers['x-request-id'] === 'string'
          ? req.headers['x-request-id']
          : undefined) ?? randomUUID(),
      timestamp: Date.now(),
      scopes: ['workspace.read', 'workspace.search'],
    };

    // 3. Route Dispatch
    try {
      if (method !== 'GET') {
        res.statusCode = 405;
        res.end(
          JSON.stringify({
            code: 'UNSUPPORTED',
            message: `Method ${method} is not supported in read-only Phase 1`,
          })
        );
        return;
      }

      // GET /api/v1/workspace
      if (pathname === '/api/v1/workspace') {
        const info = await workspace.getWorkspaceInfo(clientContext);
        res.statusCode = 200;
        res.end(JSON.stringify(info));
        return;
      }

      // GET /api/v1/entries?path=...
      if (pathname === '/api/v1/entries') {
        const subPath = parsedUrl.searchParams.get('path') ?? '';
        const entries = await workspace.listEntries(subPath, clientContext);
        res.statusCode = 200;
        res.end(JSON.stringify(entries));
        return;
      }

      // GET /api/v1/search?q=...&tags=...&pathPrefix=...&limit=...&offset=...
      if (pathname === '/api/v1/search') {
        const q = parsedUrl.searchParams.get('q') ?? '';
        const tagsParam = parsedUrl.searchParams.get('tags');
        const tags = tagsParam
          ? tagsParam
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined;
        const pathPrefix = parsedUrl.searchParams.get('pathPrefix') ?? undefined;
        const limitParam = parsedUrl.searchParams.get('limit');
        const offsetParam = parsedUrl.searchParams.get('offset');

        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

        const results = await workspace.search(
          {
            query: q,
            tags,
            pathPrefix,
            limit: isNaN(limit!) ? undefined : limit,
            offset: isNaN(offset!) ? undefined : offset,
          },
          clientContext
        );

        res.statusCode = 200;
        res.end(JSON.stringify(results));
        return;
      }

      // GET /api/v1/notes/...
      if (pathname.startsWith('/api/v1/notes/')) {
        const rawNoteSegment = pathname.slice('/api/v1/notes/'.length);
        if (!rawNoteSegment) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              code: 'INVALID_REQUEST',
              message: 'Note path must be specified',
            })
          );
          return;
        }

        let decodedSegment: string;
        try {
          decodedSegment = decodeURIComponent(rawNoteSegment);
        } catch {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              code: 'INVALID_PATH',
              message: `Malformed URI encoding in note path: "${rawNoteSegment}"`,
            })
          );
          return;
        }

        // Subaction routes: /backlinks, /links, /properties, /graph-neighbors
        if (decodedSegment.endsWith('/backlinks')) {
          const notePath = decodedSegment.slice(0, -'/backlinks'.length);
          const backlinks = await workspace.getBacklinks(notePath, clientContext);
          res.statusCode = 200;
          res.end(JSON.stringify(backlinks));
          return;
        }

        if (decodedSegment.endsWith('/links')) {
          const notePath = decodedSegment.slice(0, -'/links'.length);
          const links = await workspace.getOutgoingLinks(notePath, clientContext);
          res.statusCode = 200;
          res.end(JSON.stringify(links));
          return;
        }

        if (decodedSegment.endsWith('/properties')) {
          const notePath = decodedSegment.slice(0, -'/properties'.length);
          const props = await workspace.getProperties(notePath, clientContext);
          res.statusCode = 200;
          res.end(JSON.stringify(props));
          return;
        }

        if (decodedSegment.endsWith('/graph-neighbors')) {
          const notePath = decodedSegment.slice(0, -'/graph-neighbors'.length);
          const maxDepthParam = parsedUrl.searchParams.get('maxDepth');
          const maxDepth = maxDepthParam ? parseInt(maxDepthParam, 10) : undefined;
          const neighbors = await workspace.getGraphNeighbors(
            notePath,
            { maxDepth: isNaN(maxDepth!) ? undefined : maxDepth },
            clientContext
          );
          res.statusCode = 200;
          res.end(JSON.stringify(neighbors));
          return;
        }

        // Default: Read note
        const note = await workspace.readNote(decodedSegment, clientContext);
        res.statusCode = 200;
        res.end(JSON.stringify(note));
        return;
      }

      // Not found
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          code: 'NOT_FOUND',
          message: `Endpoint "${pathname}" not found`,
        })
      );
    } catch (err) {
      const apiErr = toApiError(err);
      res.statusCode = apiErr.status;
      res.end(JSON.stringify(apiErr.body));
    }
  });

  return server;
}

/**
 * Starts the OpenOb Gateway on a loopback interface.
 */
export async function startGateway(options: GatewayOptions): Promise<RunningGateway> {
  const host = options.host ?? '127.0.0.1'; // Binds STRICTLY to loopback by default
  const port = options.port ?? 4200;

  const server = createGatewayServer(options);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;
  const actualHost = address.address;
  const url = `http://${actualHost}:${actualPort}`;

  return {
    host: actualHost,
    port: actualPort,
    url,
    server,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

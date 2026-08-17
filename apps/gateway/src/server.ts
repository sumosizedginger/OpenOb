import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ClientContext,
  ForbiddenError,
  InvalidRequestError,
  OpenObWorkspace,
  PayloadTooLargeError,
  toApiError,
  UnauthorizedError,
  WorkspaceChangeEvent,
} from '@okw/workspace';

export interface GatewayOptions {
  readonly workspace: OpenObWorkspace;
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly scopes?: string[];
  readonly maxBodyBytes?: number;
  readonly serveWeb?: boolean;
  readonly webDistPath?: string;
}

const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export interface RunningGateway {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly server: http.Server;
  stop(): Promise<void>;
}

async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number = 10 * 1024 * 1024
): Promise<any> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      reject(new InvalidRequestError('Content-Type must be application/json'));
      return;
    }

    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (!isNaN(len) && len > maxBytes) {
        req.resume(); // Drain stream without storing into memory
        reject(
          new PayloadTooLargeError(
            `Request body size (${len} bytes) exceeds maximum limit (${maxBytes} bytes)`
          )
        );
        return;
      }
    }

    let body = '';
    let bytes = 0;
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        exceeded = true;
        req.pause(); // Stop reading more into memory
        req.resume(); // Drain stream so socket doesn't hang
        reject(
          new PayloadTooLargeError(
            `Request payload exceeds maximum allowed size (${maxBytes} bytes)`
          )
        );
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (exceeded) return;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err: any) {
        reject(new InvalidRequestError(`Malformed JSON payload: ${err.message}`));
      }
    });

    req.on('error', (err) => {
      if (!exceeded) {
        reject(err);
      }
    });
  });
}

/**
 * Creates and starts a local loopback gateway HTTP server for OpenOb.
 */
export function createGatewayServer(options: GatewayOptions): http.Server {
  const { workspace, token, scopes, maxBodyBytes } = options;
  const activeSseConnections = new Set<http.ServerResponse>();
  const activeSockets = new Set<import('node:net').Socket>();

  const server = http.createServer(async (req, res) => {
    // Standard secure headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // CORS headers for local loopback web UI access
    res.setHeader('Access-Control-Allow-Origin', (req.headers.origin as string) || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method?.toUpperCase() === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Default API content type (can be overridden by static asset delivery)
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

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
          readOnly: workspace.readOnly,
          vault: workspace.vaultName,
        })
      );
      return;
    }

    // 2. Static Web Application delivery if serveWeb is enabled (public web asset delivery)
    if (
      options.serveWeb &&
      (method === 'GET' || method === 'HEAD') &&
      !pathname.startsWith('/api/')
    ) {
      const defaultWebDist = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../web/dist'
      );
      let webDistDir = path.resolve(options.webDistPath || defaultWebDist);
      if (!fs.existsSync(webDistDir)) {
        const fallbackDist = path.resolve(process.cwd(), 'apps/web/dist');
        if (fs.existsSync(fallbackDist)) {
          webDistDir = fallbackDist;
        }
      }

      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let targetFile = path.resolve(webDistDir, relativePath);

      // Disallow directory traversal outside of webDistDir
      if (targetFile.startsWith(webDistDir)) {
        let fileBuffer: Buffer | null = null;
        let fileExt = path.extname(targetFile).toLowerCase();

        try {
          const stat = await fs.promises.stat(targetFile);
          if (stat.isDirectory()) {
            targetFile = path.join(targetFile, 'index.html');
            fileExt = '.html';
          }
          fileBuffer = await fs.promises.readFile(targetFile);
        } catch (err: any) {
          // SPA fallback: serve index.html for non-asset routes
          if (
            err.code === 'ENOENT' &&
            !fileExt.match(/\.(js|css|json|png|jpg|jpeg|gif|svg|ico|woff2?|ttf)$/i)
          ) {
            try {
              const indexPath = path.join(webDistDir, 'index.html');
              fileBuffer = await fs.promises.readFile(indexPath);
              fileExt = '.html';
            } catch {
              fileBuffer = null;
            }
          }
        }

        if (fileBuffer) {
          const mimeType = STATIC_MIME_TYPES[fileExt] || 'application/octet-stream';
          res.statusCode = 200;
          res.setHeader('Content-Type', mimeType);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-Frame-Options', 'DENY');
          if (method === 'HEAD') {
            res.end();
          } else {
            res.end(fileBuffer);
          }
          return;
        }
      }
    }

    // 3. Authentication check for /api/v1/* routes
    if (token) {
      const authHeader = req.headers['authorization'];
      const customTokenHeader = req.headers['x-openob-token'];

      let clientToken: string | undefined;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        clientToken = authHeader.slice(7).trim();
      } else if (typeof customTokenHeader === 'string') {
        clientToken = customTokenHeader.trim();
      }

      let isAuthorized = false;
      if (clientToken && typeof clientToken === 'string') {
        const expectedBuf = Buffer.from(token);
        const actualBuf = Buffer.from(clientToken);
        if (expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        const err = toApiError(new UnauthorizedError());
        res.statusCode = err.status;
        res.end(JSON.stringify(err.body));
        return;
      }
    }

    // Extract client identity context (scopes are ALWAYS server-configured, never client-forged)
    const defaultScopes = !workspace.readOnly
      ? [
          'workspace.read',
          'workspace.search',
          'workspace.write',
          'properties.write',
          'workspace.rename',
          'workspace.delete',
        ]
      : ['workspace.read', 'workspace.search'];

    const clientIdHeader = req.headers['x-openob-client-id'];
    const clientContext: ClientContext = {
      clientId: typeof clientIdHeader === 'string' ? clientIdHeader : undefined,
      requestId:
        (typeof req.headers['x-request-id'] === 'string'
          ? req.headers['x-request-id']
          : undefined) ?? randomUUID(),
      timestamp: Date.now(),
      scopes: scopes ?? defaultScopes,
    };

    // 3. Route Dispatch
    try {
      // GET /api/v1/events (Live Workspace Change Stream via SSE)
      if (pathname === '/api/v1/events' && method === 'GET') {
        if (!clientContext.scopes?.includes('workspace.read')) {
          const err = toApiError(
            new ForbiddenError('Forbidden: events stream requires workspace.read scope')
          );
          res.statusCode = err.status;
          res.end(JSON.stringify(err.body));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }
        res.write(': connected\n\n');

        const publisher = workspace.getEventPublisher();
        const serverInstanceId = publisher.serverInstanceId;

        const lastEventIdHeader =
          (req.headers['last-event-id'] as string) ||
          (req.headers['x-last-event-id'] as string) ||
          parsedUrl.searchParams.get('lastEventId') ||
          '';

        let lastSeq = 0;
        let lastServerInstanceId: string | undefined;

        if (lastEventIdHeader && typeof lastEventIdHeader === 'string') {
          if (lastEventIdHeader.startsWith('evt_')) {
            const parts = lastEventIdHeader.split('_');
            const parsed = parseInt(parts[1], 10);
            if (!isNaN(parsed)) lastSeq = parsed;
          } else if (lastEventIdHeader.includes(':')) {
            const [instId, seqStr] = lastEventIdHeader.split(':');
            lastServerInstanceId = instId;
            const parsed = parseInt(seqStr, 10);
            if (!isNaN(parsed)) lastSeq = parsed;
          } else {
            const parsed = parseInt(lastEventIdHeader, 10);
            if (!isNaN(parsed)) lastSeq = parsed;
          }
        }

        const sendEvent = (event: WorkspaceChangeEvent) => {
          if (res.writableEnded || res.destroyed) return;
          res.write(
            `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          );
        };

        if (lastSeq > 0) {
          const replay = publisher.getEventsSince(lastSeq, lastServerInstanceId);
          if (replay.reset) {
            const resetEvent: WorkspaceChangeEvent = {
              schemaVersion: 1,
              eventId: `reset_${Date.now()}`,
              sequence: publisher.getCurrentSequence(),
              serverInstanceId,
              timestamp: Date.now(),
              type: 'stream.reset',
              reason: replay.reason,
            };
            sendEvent(resetEvent);
          } else {
            for (const missed of replay.events) {
              sendEvent(missed);
            }
          }
        }

        const unsubscribe = publisher.subscribe((event) => {
          sendEvent(event);
        });

        const heartbeatTimer = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(heartbeatTimer);
            return;
          }
          res.write(': heartbeat\n\n');
        }, 15000);

        activeSseConnections.add(res);

        const cleanup = () => {
          clearInterval(heartbeatTimer);
          unsubscribe();
          activeSseConnections.delete(res);
        };

        req.on('close', cleanup);
        req.on('end', cleanup);
        res.on('close', cleanup);
        res.on('finish', cleanup);
        return;
      }

      // POST /api/v1/notes (Create note)
      if (pathname === '/api/v1/notes' && method === 'POST') {
        const body = await readJsonBody(req, maxBodyBytes);
        const result = await workspace.createNote(body, clientContext);
        res.statusCode = 201;
        res.end(JSON.stringify(result));
        return;
      }

      // PATCH /api/v1/notes/:path/properties (Set/remove property)
      if (
        pathname.startsWith('/api/v1/notes/') &&
        pathname.endsWith('/properties') &&
        method === 'PATCH'
      ) {
        const rawNoteSegment = pathname.slice(
          '/api/v1/notes/'.length,
          pathname.length - '/properties'.length
        );
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

        const body = await readJsonBody(req, maxBodyBytes);
        const result = await workspace.setProperty(
          {
            path: decodedSegment,
            key: body.key,
            value: body.value,
            expectedVersion: body.expectedVersion,
          },
          clientContext
        );
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return;
      }

      // PUT /api/v1/notes/:path (Update note content)
      if (pathname.startsWith('/api/v1/notes/') && method === 'PUT') {
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

        const body = await readJsonBody(req, maxBodyBytes);
        const result = await workspace.updateNote(
          {
            path: decodedSegment,
            content: body.content,
            expectedVersion: body.expectedVersion,
          },
          clientContext
        );
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/v1/notes/:path/rename (Rename note)
      if (
        pathname.startsWith('/api/v1/notes/') &&
        pathname.endsWith('/rename') &&
        method === 'POST'
      ) {
        const rawNoteSegment = pathname.slice(
          '/api/v1/notes/'.length,
          pathname.length - '/rename'.length
        );
        if (!rawNoteSegment) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              code: 'INVALID_REQUEST',
              message: 'Source note path must be specified',
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
              message: `Malformed URI encoding in source note path: "${rawNoteSegment}"`,
            })
          );
          return;
        }

        const body = await readJsonBody(req, maxBodyBytes);
        const result = await workspace.renameNote(
          {
            oldPath: decodedSegment,
            newPath: body.newPath,
            expectedVersion: body.expectedVersion,
            updateLinks: body.updateLinks,
          },
          clientContext
        );
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return;
      }

      // DELETE /api/v1/notes/:path (Delete note)
      if (pathname.startsWith('/api/v1/notes/') && method === 'DELETE') {
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

        let expectedVersion: any;
        const ifMatch = req.headers['if-match'];
        if (ifMatch && typeof ifMatch === 'string') {
          expectedVersion = { token: ifMatch.replace(/^"|"$/g, '').trim() };
        } else {
          const body = await readJsonBody(req, maxBodyBytes);
          expectedVersion = body?.expectedVersion;
        }

        const result = await workspace.deleteNote(
          {
            path: decodedSegment,
            expectedVersion,
          },
          clientContext
        );
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return;
      }

      // GET routes
      if (method === 'GET') {
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
          const subactions = [
            {
              suffix: '/backlinks',
              handler: (p: string) => workspace.getBacklinks(p, clientContext),
            },
            {
              suffix: '/links',
              handler: (p: string) => workspace.getOutgoingLinks(p, clientContext),
            },
            {
              suffix: '/properties',
              handler: (p: string) => workspace.getProperties(p, clientContext),
            },
            {
              suffix: '/graph-neighbors',
              handler: (p: string) => {
                const maxDepthParam = parsedUrl.searchParams.get('maxDepth');
                const maxDepth = maxDepthParam ? parseInt(maxDepthParam, 10) : undefined;
                return workspace.getGraphNeighbors(
                  p,
                  { maxDepth: isNaN(maxDepth!) ? undefined : maxDepth },
                  clientContext
                );
              },
            },
          ];

          const matchedSubaction = subactions.find((s) => decodedSegment.endsWith(s.suffix));

          if (matchedSubaction) {
            const targetNotePath = decodedSegment.slice(0, -matchedSubaction.suffix.length);

            // Disambiguation: Check if the full decodedSegment is an existing note file
            let isDirectNote = false;
            try {
              const meta = await workspace.getNoteMetadata(decodedSegment);
              if (meta) isDirectNote = true;
            } catch {
              isDirectNote = false;
            }

            if (!isDirectNote) {
              const subactionResult = await matchedSubaction.handler(targetNotePath);
              res.statusCode = 200;
              res.end(JSON.stringify(subactionResult));
              return;
            }
          }

          // Default: Read note
          const note = await workspace.readNote(decodedSegment, clientContext);
          res.statusCode = 200;
          res.end(JSON.stringify(note));
          return;
        }
      }

      // Any other method or route
      res.statusCode = method === 'GET' ? 404 : 405;
      res.end(
        JSON.stringify({
          code: method === 'GET' ? 'NOT_FOUND' : 'UNSUPPORTED',
          message:
            method === 'GET'
              ? `Endpoint "${pathname}" not found`
              : `Method ${method} is not supported for "${pathname}"`,
        })
      );
    } catch (err) {
      const apiErr = toApiError(err);
      res.statusCode = apiErr.status;
      res.end(JSON.stringify(apiErr.body));
    }
  });

  server.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
  });

  server.on('close', () => {
    for (const conn of activeSseConnections) {
      try {
        if (!conn.writableEnded) conn.end();
      } catch {}
    }
    activeSseConnections.clear();
    for (const socket of activeSockets) {
      try {
        socket.destroy();
      } catch {}
    }
    activeSockets.clear();
  });

  return server;
}

const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

/**
 * Checks if a host string refers to a local loopback interface.
 */
export function isLoopbackHost(host: string): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  if (ALLOWED_LOOPBACK_HOSTS.has(trimmed)) return true;
  // Match standard 127.x.x.x loopback block
  if (/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Asserts that the host is strictly a loopback address.
 */
export function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Gateway can only bind to loopback interfaces (127.0.0.1, ::1, localhost). Non-loopback host "${host}" is rejected for security.`
    );
  }
}

/**
 * Starts the OpenOb Gateway on a loopback interface.
 */
export async function startGateway(options: GatewayOptions): Promise<RunningGateway> {
  const host = options.host ?? '127.0.0.1'; // Binds STRICTLY to loopback by default
  assertLoopbackHost(host);

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
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

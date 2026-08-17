import { Readable, Writable } from 'node:stream';
import process from 'node:process';
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/server';

export interface SafeStdioTransportOptions {
  /**
   * Maximum allowed size for a single incoming JSON-RPC message in bytes.
   * Default: 10 MB (10 * 1024 * 1024 bytes), aligning with Gateway maxBodyBytes.
   */
  readonly maxMessageBytes?: number;
}

export const DEFAULT_MAX_MCP_MESSAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Safe, production-grade stdio transport for OpenOb MCP server.
 * Guarantees that oversized or malformed incoming messages never crash or terminate
 * the process. Bounded memory consumption protects against DoS attacks.
 */
export class SafeStdioServerTransport implements Transport {
  private readonly _stdin: Readable;
  private readonly _stdout: Writable;
  private readonly _maxMessageBytes: number;

  private _started = false;
  private _closed = false;
  private _buffer = '';
  private _discardingOversized = false;
  private _discardedBytes = 0;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    stdin: Readable = process.stdin,
    stdout: Writable = process.stdout,
    options: SafeStdioTransportOptions = {}
  ) {
    this._stdin = stdin;
    this._stdout = stdout;
    this._maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MCP_MESSAGE_BYTES;
  }

  get maxMessageBytes(): number {
    return this._maxMessageBytes;
  }

  private _onData = (chunk: Buffer | string): void => {
    if (this._closed) return;
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let searchIndex = 0;

    while (searchIndex < str.length) {
      const newlineIndex = str.indexOf('\n', searchIndex);
      if (newlineIndex === -1) {
        // No newline in remainder of this chunk
        const remaining = str.slice(searchIndex);
        if (this._discardingOversized) {
          this._discardedBytes += Buffer.byteLength(remaining);
        } else {
          this._buffer += remaining;
          if (Buffer.byteLength(this._buffer) > this._maxMessageBytes) {
            this._discardingOversized = true;
            this._discardedBytes = Buffer.byteLength(this._buffer);
            this._buffer = '';
            process.stderr.write(
              `[openob-mcp] Inbound message exceeded maximum allowed size of ${this._maxMessageBytes} bytes; discarding remainder of message.\n`
            );
          }
        }
        break;
      } else {
        // Found newline delimiter
        const linePiece = str.slice(searchIndex, newlineIndex);
        searchIndex = newlineIndex + 1;

        if (this._discardingOversized) {
          this._discardedBytes += Buffer.byteLength(linePiece);
          const totalDiscarded = this._discardedBytes;
          this._discardingOversized = false;
          this._discardedBytes = 0;

          // Emit structured JSON-RPC error response to client
          this.send({
            jsonrpc: '2.0',
            id: 0,
            error: {
              code: -32600,
              message: `Invalid Request: Message size (${totalDiscarded} bytes) exceeds maximum allowed limit of ${this._maxMessageBytes} bytes (PAYLOAD_TOO_LARGE)`,
            },
          }).catch(() => {});
        } else {
          this._buffer += linePiece;
          const fullLine = this._buffer.replace(/\r$/, '');
          this._buffer = '';

          if (fullLine.trim().length > 0) {
            this._processLine(fullLine);
          }
        }
      }
    }
  };

  private _processLine(line: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (_parseErr) {
      process.stderr.write(`[openob-mcp] Rejected malformed JSON input; server remaining alive.\n`);
      this.send({
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON payload received',
        },
      }).catch(() => {});
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      this.send({
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32600,
          message: 'Invalid Request: Top-level JSON-RPC value must be an object',
        },
      }).catch(() => {});
      return;
    }

    try {
      this.onmessage?.(parsed as JSONRPCMessage);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onerror?.(error);
    }
  }

  private _onEnd = (): void => {
    this.close().catch(() => {});
  };

  private _onError = (error: Error): void => {
    this.onerror?.(error);
  };

  async start(): Promise<void> {
    if (this._started) {
      throw new Error('SafeStdioServerTransport is already started.');
    }
    this._started = true;
    this._stdin.on('data', this._onData);
    this._stdin.on('end', this._onEnd);
    this._stdin.on('error', this._onError);
    this._stdout.on('error', this._onError);
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._stdin.off('data', this._onData);
    this._stdin.off('end', this._onEnd);
    this._stdin.off('error', this._onError);
    this._stdout.off('error', this._onError);
    this._buffer = '';
    this._discardingOversized = false;
    this.onclose?.();
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      return Promise.reject(new Error('SafeStdioServerTransport is closed'));
    }

    return new Promise((resolve, reject) => {
      let serialized: string;
      try {
        serialized = JSON.stringify(message) + '\n';
      } catch (err) {
        return reject(err);
      }

      let settled = false;
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        this._stdout.off('error', onError);
        this._stdout.off('drain', onDrain);
        reject(error);
      };

      const onDrain = () => {
        if (settled) return;
        settled = true;
        this._stdout.off('error', onError);
        this._stdout.off('drain', onDrain);
        resolve();
      };

      this._stdout.once('error', onError);
      if (this._stdout.write(serialized)) {
        if (settled) return;
        settled = true;
        this._stdout.off('error', onError);
        resolve();
      } else {
        this._stdout.once('drain', onDrain);
      }
    });
  }
}

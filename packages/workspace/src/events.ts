import { VaultPath } from '@okw/core';
import { ExpectedVersionDTO } from './types.js';

export type WorkspaceChangeEventType =
  | 'note.created'
  | 'note.modified'
  | 'note.property_changed'
  | 'note.renamed'
  | 'note.deleted'
  | 'index.degraded'
  | 'index.recovered'
  | 'stream.reset';

export interface WorkspaceChangeEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly sequence: number;
  readonly serverInstanceId: string;
  readonly timestamp: number;
  readonly type: WorkspaceChangeEventType;
  readonly path?: VaultPath;
  readonly oldPath?: VaultPath;
  readonly newPath?: VaultPath;
  readonly version?: ExpectedVersionDTO;
  readonly operation?: string;
  readonly requestId?: string;
  readonly clientId?: string;
  readonly indexStatus?: 'verified' | 'degraded';
  readonly affectedPaths?: VaultPath[];
  readonly reason?: string;
}

export type PublishEventParams = Omit<
  WorkspaceChangeEvent,
  'schemaVersion' | 'eventId' | 'sequence' | 'serverInstanceId' | 'timestamp'
> & {
  readonly timestamp?: number;
};

export type EventReplayResult =
  | { readonly reset: false; readonly events: WorkspaceChangeEvent[] }
  | { readonly reset: true; readonly reason: string };

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * In-memory event publisher with a bounded ring buffer for SSE replays.
 */
export class WorkspaceEventPublisher {
  readonly serverInstanceId: string;
  private readonly bufferCapacity: number;
  private sequenceCounter = 0;
  private readonly buffer: WorkspaceChangeEvent[] = [];
  private readonly listeners = new Set<(event: WorkspaceChangeEvent) => void>();

  constructor(serverInstanceId?: string, bufferCapacity = 1024) {
    this.serverInstanceId = serverInstanceId || generateId();
    this.bufferCapacity = Math.max(1, bufferCapacity);
  }

  /**
   * Publish a new authoritative committed change event.
   */
  publish(params: PublishEventParams): WorkspaceChangeEvent {
    this.sequenceCounter++;
    const seq = this.sequenceCounter;
    const event: WorkspaceChangeEvent = {
      schemaVersion: 1,
      eventId: `evt_${seq}_${generateId().slice(0, 8)}`,
      sequence: seq,
      serverInstanceId: this.serverInstanceId,
      timestamp: params.timestamp ?? Date.now(),
      type: params.type,
      path: params.path,
      oldPath: params.oldPath,
      newPath: params.newPath,
      version: params.version,
      operation: params.operation,
      requestId: params.requestId,
      clientId: params.clientId,
      indexStatus: params.indexStatus,
      affectedPaths: params.affectedPaths,
      reason: params.reason,
    };

    // Maintain bounded ring buffer
    this.buffer.push(event);
    if (this.buffer.length > this.bufferCapacity) {
      this.buffer.shift();
    }

    // Broadcast to active live subscribers
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[WorkspaceEventPublisher] Subscriber error:', err);
      }
    }

    return event;
  }

  /**
   * Replay missed events starting after lastSequence.
   * If lastSequence is 0, returns empty list (client wants to start receiving from now).
   * If lastSequence is older than buffer's oldest event, or serverInstanceId doesn't match, returns reset.
   */
  getEventsSince(lastSequence: number, clientServerInstanceId?: string): EventReplayResult {
    if (clientServerInstanceId && clientServerInstanceId !== this.serverInstanceId) {
      return { reset: true, reason: 'server_restarted' };
    }

    if (lastSequence <= 0) {
      return { reset: false, events: [] };
    }

    if (lastSequence >= this.sequenceCounter) {
      return { reset: false, events: [] };
    }

    if (this.buffer.length === 0) {
      return { reset: true, reason: 'replay_window_expired' };
    }

    const oldestSeqInBuffer = this.buffer[0].sequence;
    if (lastSequence < oldestSeqInBuffer - 1) {
      return { reset: true, reason: 'replay_window_expired' };
    }

    const missed = this.buffer.filter((e) => e.sequence > lastSequence);
    return { reset: false, events: missed };
  }

  /**
   * Subscribe to live events. Returns an unsubscribe function.
   */
  subscribe(listener: (event: WorkspaceChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current sequence number.
   */
  getCurrentSequence(): number {
    return this.sequenceCounter;
  }

  /**
   * Current active listener count (for diagnostics / leak testing).
   */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  /**
   * Clear all subscribers and buffer (for shutdown).
   */
  clear(): void {
    this.listeners.clear();
    this.buffer.length = 0;
  }
}

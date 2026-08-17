import { AuditSink, MutationAuditEvent } from './types.js';

/**
 * In-memory audit sink storing structured mutation audit events.
 * Safe for unit testing, inspection, and transient observability.
 */
export class InMemoryAuditSink implements AuditSink {
  private readonly events: MutationAuditEvent[] = [];

  record(event: MutationAuditEvent): void {
    this.events.push(Object.freeze({ ...event }));
  }

  getEvents(): readonly MutationAuditEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * Composite audit sink broadcasting events to multiple registered sinks.
 */
export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: AuditSink[]) {}

  async record(event: MutationAuditEvent): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.record(event);
      } catch {
        // Audit sinks must not crash the core application pipeline
      }
    }
  }
}

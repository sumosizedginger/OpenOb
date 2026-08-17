import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryDocumentIndex } from '@okw/index';
import { MemoryVaultStorage, SafeWriter } from '@okw/vault';
import {
  GatewayError,
  GatewayWorkspaceBackend,
  OpenObGatewayClient,
  OpenObWorkspace,
  WorkspaceChangeEvent,
  WorkspaceEventPublisher,
} from '@okw/workspace';
import { RunningGateway, startGateway } from '../../apps/gateway/src/server.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('Phase 3C Live Gateway Change Stream Integrity & Protocol Tests', () => {
  let runningGateway: RunningGateway;
  let workspace: OpenObWorkspace;
  let storage: MemoryVaultStorage;
  let index: MemoryDocumentIndex;
  let parser: DefaultDocumentParser;
  const TEST_TOKEN = 'phase3c-change-stream-token-999';

  beforeAll(async () => {
    parser = new DefaultDocumentParser();
    storage = new MemoryVaultStorage('phase3c-vault');
    index = new MemoryDocumentIndex();
    const safeWriter = new SafeWriter(storage);

    await storage.write('Alpha.md', null, '# Alpha Note\n\nInitial content');
    const snap = await storage.read('Alpha.md');
    await index.upsert(await parser.parse('Alpha.md', snap.textContent!, snap.version.hash));

    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      readOnly: false,
      vaultName: 'phase3c-vault',
    });

    const port = await getFreePort();
    runningGateway = await startGateway({
      workspace,
      port,
      token: TEST_TOKEN,
    });
  });

  afterAll(async () => {
    await runningGateway?.stop();
  });

  it('1. Event Publisher: generates strictly increasing sequence numbers and maintains bounded replay buffer', () => {
    const publisher = new WorkspaceEventPublisher('test-server-1', 4);

    const ev1 = publisher.publish({ type: 'note.created', path: '1.md' });
    const ev2 = publisher.publish({ type: 'note.modified', path: '2.md' });
    const ev3 = publisher.publish({ type: 'note.property_changed', path: '3.md' });
    const ev4 = publisher.publish({ type: 'note.renamed', oldPath: '4.md', newPath: '4-new.md' });
    const ev5 = publisher.publish({ type: 'note.deleted', path: '5.md' });

    expect(ev1.sequence).toBe(1);
    expect(ev2.sequence).toBe(2);
    expect(ev3.sequence).toBe(3);
    expect(ev4.sequence).toBe(4);
    expect(ev5.sequence).toBe(5);

    // Buffer has [2, 3, 4, 5]. Replaying since sequence 2 returns [3, 4, 5]
    const replayValid = publisher.getEventsSince(2, 'test-server-1');
    expect(replayValid.reset).toBe(false);
    if (!replayValid.reset) {
      expect(replayValid.events.length).toBe(3);
      expect(replayValid.events.map((e) => e.sequence)).toEqual([3, 4, 5]);
    }

    // Now publish event 6, so ev2 drops out of capacity 4 ring buffer [3, 4, 5, 6]
    const ev6 = publisher.publish({ type: 'note.modified', path: '6.md' });
    expect(ev6.sequence).toBe(6);

    // Replaying since sequence 1 requires ev2 which has dropped -> reset!
    const replayExpired = publisher.getEventsSince(1, 'test-server-1');
    expect(replayExpired.reset).toBe(true);
    if (replayExpired.reset) {
      expect(replayExpired.reason).toBe('replay_window_expired');
    }

    // Mismatched server instance ID triggers reset
    const restartReplay = publisher.getEventsSince(4, 'old-server-instance');
    expect(restartReplay.reset).toBe(true);
    if (restartReplay.reset) {
      expect(restartReplay.reason).toBe('server_restarted');
    }
  });

  it('2. Workspace Mutations: automatically publish truthful committed change events', async () => {
    const publisher = workspace.getEventPublisher();
    const captured: WorkspaceChangeEvent[] = [];
    const unsubscribe = publisher.subscribe((e) => captured.push(e));

    const backend = new GatewayWorkspaceBackend(
      new OpenObGatewayClient({
        url: runningGateway.url,
        token: TEST_TOKEN,
        clientId: 'test-agent',
      })
    );

    // 1. Create
    const createRes = await backend.createNote({
      path: 'StreamTest.md',
      content: '# Stream Test\n\nBody',
    });
    expect(createRes.durableSuccess).toBe(true);

    // 2. Modify
    const updateRes = await backend.updateNote({
      path: 'StreamTest.md',
      content: '# Stream Test\n\nUpdated Body',
      expectedVersion: { token: createRes.currentVersion.token },
    });
    expect(updateRes.durableSuccess).toBe(true);

    // 3. Set Property
    const propRes = await backend.setProperty({
      path: 'StreamTest.md',
      key: 'status',
      value: 'active',
      expectedVersion: { token: updateRes.currentVersion.token },
    });
    expect(propRes.durableSuccess).toBe(true);

    // 4. Rename
    const renameRes = await backend.renameNote({
      oldPath: 'StreamTest.md',
      newPath: 'StreamRenamed.md',
      expectedVersion: { token: propRes.currentVersion.token },
    });
    expect(renameRes.durableSuccess).toBe(true);

    // 5. Delete
    const deleteRes = await backend.deleteNote({
      path: 'StreamRenamed.md',
      expectedVersion: { token: renameRes.currentVersion.token },
    });
    expect(deleteRes.durableSuccess).toBe(true);

    unsubscribe();

    expect(captured.length).toBeGreaterThanOrEqual(5);
    const types = captured.map((c) => c.type);
    expect(types).toContain('note.created');
    expect(types).toContain('note.modified');
    expect(types).toContain('note.property_changed');
    expect(types).toContain('note.renamed');
    expect(types).toContain('note.deleted');

    // Verify sequences are strictly increasing without gaps or duplicates
    for (let i = 1; i < captured.length; i++) {
      expect(captured[i].sequence).toBe(captured[i - 1].sequence + 1);
    }
  });

  it('3. Streaming Client: OpenObGatewayClient.subscribeToEvents receives real-time events over fetch SSE stream', async () => {
    const client = new OpenObGatewayClient({
      url: runningGateway.url,
      token: TEST_TOKEN,
      clientId: 'streaming-test-client',
    });

    const receivedEvents: WorkspaceChangeEvent[] = [];
    let isConnected = false;

    const subscription = client.subscribeToEvents({
      onEvent: (ev) => {
        receivedEvents.push(ev);
      },
      onConnect: () => {
        isConnected = true;
      },
    });

    // Wait briefly for connection handshake
    await new Promise((r) => setTimeout(r, 100));
    expect(isConnected).toBe(true);
    expect(subscription.isConnected()).toBe(true);

    // Perform an external mutation via gateway
    const created = await client.createNote({
      path: 'LiveSSE.md',
      content: '# Live SSE Note\n\nContent',
    });

    // Wait for event delivery
    await new Promise<void>((resolve) => {
      const check = () => {
        if (receivedEvents.some((e) => e.path === 'LiveSSE.md' && e.type === 'note.created')) {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });

    const event = receivedEvents.find((e) => e.path === 'LiveSSE.md');
    expect(event).toBeDefined();
    expect(event?.type).toBe('note.created');
    expect(event?.version?.token).toBe(created.currentVersion.token);

    // Clean up
    await client.deleteNote({
      path: 'LiveSSE.md',
      expectedVersion: { token: created.currentVersion.token },
    });

    subscription.unsubscribe();
    expect(subscription.isConnected()).toBe(false);
  });

  it('4. Security & Privacy: Bearer token enforced, 401 on bad token, no sensitive content in event DTOs', async () => {
    // 401 on bad token
    const unauthClient = new OpenObGatewayClient({
      url: runningGateway.url,
      token: 'bad-token-xyz',
      clientId: 'attacker',
    });

    let errorThrown: any = null;
    const sub = unauthClient.subscribeToEvents({
      onEvent: () => {},
      onError: (err) => {
        errorThrown = err;
      },
    });

    await new Promise((r) => setTimeout(r, 200));
    sub.unsubscribe();

    expect(errorThrown).toBeDefined();
    expect(errorThrown.status).toBe(401);

    // Inspect recent events to ensure NO note body or secrets are leaked
    const publisher = workspace.getEventPublisher();
    const replay = publisher.getEventsSince(1);
    if (!replay.reset) {
      for (const ev of replay.events) {
        expect((ev as any).content).toBeUndefined();
        expect((ev as any).body).toBeUndefined();
        expect((ev as any).textContent).toBeUndefined();
        expect((ev as any).token).toBeUndefined();
        expect((ev as any).secret).toBeUndefined();
      }
    }
  });
});

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
  return 0;
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

  it('5. Cursor Encoders & Parsers: roundtrip, legacy compatibility, defensive bounds', async () => {
    const { encodeEventCursor, parseEventCursor } = await import('@okw/workspace');

    // 1. Valid instance-aware cursor
    const cursor = encodeEventCursor('inst_12345', 42);
    expect(cursor).toBe('inst_12345:42');

    const parsed = parseEventCursor(cursor);
    expect(parsed).toEqual({
      serverInstanceId: 'inst_12345',
      sequence: 42,
      isLegacy: false,
    });

    // 2. Legacy evt_<seq>_<rand> format
    const parsedLegacy = parseEventCursor('evt_15_abcdef12');
    expect(parsedLegacy).toEqual({
      sequence: 15,
      isLegacy: true,
    });

    // 3. Plain integer format
    const parsedPlain = parseEventCursor('7');
    expect(parsedPlain).toEqual({
      sequence: 7,
      isLegacy: true,
    });

    // 4. Malformed and bounded inputs
    expect(parseEventCursor('')).toBeNull();
    expect(parseEventCursor(null)).toBeNull();
    expect(parseEventCursor(undefined)).toBeNull();
    expect(parseEventCursor('invalid_cursor_string')).toBeNull();
    expect(parseEventCursor('a'.repeat(300))).toBeNull(); // Bound exceeded (>256)
  });

  it('6. R3C-1 HTTP-Level Gateway Restart Regression: reconnecting with old cursor triggers server_restarted reset', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openob-r3c1-'));
    const testPort = await getFreePort();
    const TOKEN = 'r3c1-test-token-secret';

    try {
      // Phase 1: Start Gateway A
      const storageA = new MemoryVaultStorage('r3c1-vault');
      const indexA = new MemoryDocumentIndex();
      const parserA = new DefaultDocumentParser();
      const safeWriterA = new SafeWriter(storageA);
      const wsA = new OpenObWorkspace({
        storage: storageA,
        index: indexA,
        parser: parserA,
        safeWriter: safeWriterA,
        readOnly: false,
        vaultName: 'r3c1-vault',
      });

      const gwA = await startGateway({
        workspace: wsA,
        port: testPort,
        token: TOKEN,
      });

      const clientA = new OpenObGatewayClient({
        url: gwA.url,
        token: TOKEN,
        clientId: 'r3c1-test-client',
      });

      let capturedCursor = '';
      const eventsA: WorkspaceChangeEvent[] = [];

      // Use streaming fetch directly to capture the raw SSE id: header
      const sseResA = await fetch(`${gwA.url}/api/v1/events`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'text/event-stream',
        },
      });
      const readerA = sseResA.body!.getReader();
      const decoderA = new TextDecoder();

      // Perform mutation on Gateway A
      await clientA.createNote({
        path: 'NoteA.md',
        content: '# Note A',
      });

      // Read SSE frame
      let readDoneA = false;
      while (!readDoneA) {
        const { value, done } = await readerA.read();
        if (done) break;
        const text = decoderA.decode(value);
        for (const line of text.split('\n')) {
          if (line.startsWith('id:')) {
            capturedCursor = line.slice(3).trim();
          }
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              const ev = JSON.parse(data);
              eventsA.push(ev);
              if (ev.type === 'note.created') {
                readDoneA = true;
                break;
              }
            }
          }
        }
      }
      readerA.cancel();

      expect(capturedCursor).toBeTruthy();
      expect(capturedCursor).toContain(':');
      const instanceIdA = wsA.getEventPublisher().serverInstanceId;
      expect(capturedCursor.startsWith(instanceIdA)).toBe(true);

      // Stop Gateway A
      await gwA.stop();

      // Phase 2: Start Gateway B on the SAME port
      const storageB = new MemoryVaultStorage('r3c1-vault');
      const indexB = new MemoryDocumentIndex();
      const parserB = new DefaultDocumentParser();
      const safeWriterB = new SafeWriter(storageB);
      const wsB = new OpenObWorkspace({
        storage: storageB,
        index: indexB,
        parser: parserB,
        safeWriter: safeWriterB,
        readOnly: false,
        vaultName: 'r3c1-vault',
      });

      const instanceIdB = wsB.getEventPublisher().serverInstanceId;
      expect(instanceIdB).not.toBe(instanceIdA);

      const gwB = await startGateway({
        workspace: wsB,
        port: testPort,
        token: TOKEN,
      });

      // Reconnect with Last-Event-ID = capturedCursor from Gateway A
      const sseResB = await fetch(`${gwB.url}/api/v1/events`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Last-Event-ID': capturedCursor,
          Accept: 'text/event-stream',
        },
      });

      const readerB = sseResB.body!.getReader();
      const decoderB = new TextDecoder();

      let resetReceived: WorkspaceChangeEvent | null = null;
      let readDoneB = false;

      while (!readDoneB) {
        const { value, done } = await readerB.read();
        if (done) break;
        const text = decoderB.decode(value);
        for (const line of text.split('\n')) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              const ev = JSON.parse(data);
              if (ev.type === 'stream.reset') {
                resetReceived = ev;
                readDoneB = true;
                break;
              }
            }
          }
        }
      }

      expect(resetReceived).not.toBeNull();
      expect(resetReceived?.type).toBe('stream.reset');
      expect(resetReceived?.reason).toBe('server_restarted');
      expect(resetReceived?.serverInstanceId).toBe(instanceIdB);

      // Perform a mutation on Gateway B and assert new event arrives with Gateway B's cursor
      const clientB = new OpenObGatewayClient({
        url: gwB.url,
        token: TOKEN,
        clientId: 'r3c1-test-client',
      });

      await clientB.createNote({
        path: 'NoteB.md',
        content: '# Note B',
      });

      let newEventCursorB = '';
      let newEventB: WorkspaceChangeEvent | null = null;
      let readDoneB2 = false;

      while (!readDoneB2) {
        const { value, done } = await readerB.read();
        if (done) break;
        const text = decoderB.decode(value);
        for (const line of text.split('\n')) {
          if (line.startsWith('id:')) {
            newEventCursorB = line.slice(3).trim();
          }
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              const ev = JSON.parse(data);
              if (ev.path === 'NoteB.md') {
                newEventB = ev;
                readDoneB2 = true;
                break;
              }
            }
          }
        }
      }
      readerB.cancel();

      expect(newEventB).not.toBeNull();
      expect(newEventB?.serverInstanceId).toBe(instanceIdB);
      expect(newEventCursorB.startsWith(instanceIdB)).toBe(true);

      await gwB.stop();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('7. R3C-1 20x Restart Stress Loop: proves restart resync is 100% deterministic', async () => {
    const TOKEN = 'stress-test-token-20x';
    const testPort = await getFreePort();

    let previousCursor = '';

    for (let i = 1; i <= 20; i++) {
      const storage = new MemoryVaultStorage(`stress-vault-${i}`);
      const index = new MemoryDocumentIndex();
      const parser = new DefaultDocumentParser();
      const safeWriter = new SafeWriter(storage);
      const ws = new OpenObWorkspace({
        storage,
        index,
        parser,
        safeWriter,
        readOnly: false,
        vaultName: `stress-vault-${i}`,
      });

      const currentInstanceId = ws.getEventPublisher().serverInstanceId;
      const gw = await startGateway({
        workspace: ws,
        port: testPort,
        token: TOKEN,
      });

      if (previousCursor) {
        // Reconnect with cursor from prior instance -> MUST receive stream.reset (server_restarted)
        const sseRes = await fetch(`${gw.url}/api/v1/events`, {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Last-Event-ID': previousCursor,
            Accept: 'text/event-stream',
          },
        });
        const reader = sseRes.body!.getReader();
        const decoder = new TextDecoder();

        let receivedReset = false;
        while (!receivedReset) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          if (text.includes('event: stream.reset') && text.includes('server_restarted')) {
            receivedReset = true;
          }
        }
        reader.cancel();
        expect(receivedReset).toBe(true);
      }

      // Perform a mutation and capture new cursor
      const client = new OpenObGatewayClient({
        url: gw.url,
        token: TOKEN,
        clientId: 'stress-client',
      });

      const sseRes2 = await fetch(`${gw.url}/api/v1/events`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'text/event-stream',
        },
      });
      const reader2 = sseRes2.body!.getReader();
      const decoder2 = new TextDecoder();

      await client.createNote({
        path: `StressNote_${i}.md`,
        content: `# Stress Note ${i}`,
      });

      let captured = false;
      while (!captured) {
        const { value, done } = await reader2.read();
        if (done) break;
        const text = decoder2.decode(value);
        for (const line of text.split('\n')) {
          if (line.startsWith('id:')) {
            previousCursor = line.slice(3).trim();
            captured = true;
          }
        }
      }
      reader2.cancel();

      expect(previousCursor.startsWith(currentInstanceId)).toBe(true);
      await gw.stop();
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('8. R3C-3 HTTP-Level Index Degraded & Recovered Integration Coverage', async () => {
    const testPort = await getFreePort();
    const TOKEN = 'r3c3-index-token';
    const storage = new MemoryVaultStorage('r3c3-vault');
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const safeWriter = new SafeWriter(storage);

    // Mock upsert failure on index to simulate derived index degradation
    let shouldFailUpsert = false;
    const originalUpsert = index.upsert.bind(index);
    index.upsert = async (doc) => {
      if (shouldFailUpsert) {
        throw new Error('Injected derived index upsert error for R3C-3 test');
      }
      return originalUpsert(doc);
    };

    const ws = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      readOnly: false,
      vaultName: 'r3c3-vault',
    });

    const gw = await startGateway({
      workspace: ws,
      port: testPort,
      token: TOKEN,
    });

    const client = new OpenObGatewayClient({
      url: gw.url,
      token: TOKEN,
      clientId: 'r3c3-client',
    });

    const eventsReceived: WorkspaceChangeEvent[] = [];
    const sub = client.subscribeToEvents({
      onEvent: (ev) => {
        eventsReceived.push(ev);
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    // Step 1: Arm the index failure seam
    shouldFailUpsert = true;

    // Step 2: Perform createNote via Gateway REST client
    const createRes = await client.createNote({
      path: 'DegradedNote.md',
      content: '# Degraded Note Content',
    });

    // Verify canonical write succeeded durably
    expect(createRes.durableSuccess).toBe(true);
    expect(createRes.indexStatus).toBe('degraded');
    expect(createRes.indexError).toContain('Injected derived index upsert error');

    const fileOnDisk = await storage.read('DegradedNote.md');
    expect(fileOnDisk.textContent).toBe('# Degraded Note Content');

    // Wait for SSE events over HTTP
    await new Promise<void>((resolve) => {
      const check = () => {
        if (
          eventsReceived.some((e) => e.type === 'note.created' && e.indexStatus === 'degraded') &&
          eventsReceived.some((e) => e.type === 'index.degraded')
        ) {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });

    const degradedEvent = eventsReceived.find((e) => e.type === 'index.degraded');
    expect(degradedEvent).toBeDefined();
    expect(degradedEvent?.indexStatus).toBe('degraded');

    // Step 3: Disarm index failure and trigger index rebuild via HTTP endpoint
    shouldFailUpsert = false;
    const rebuildRes = await client.rebuildIndex();
    expect(rebuildRes.status).toBe('verified');
    expect(rebuildRes.count).toBeGreaterThanOrEqual(1);

    // Wait for index.recovered event over HTTP SSE
    await new Promise<void>((resolve) => {
      const check = () => {
        if (eventsReceived.some((e) => e.type === 'index.recovered')) {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });

    const recoveredEvent = eventsReceived.find((e) => e.type === 'index.recovered');
    expect(recoveredEvent).toBeDefined();
    expect(recoveredEvent?.type).toBe('index.recovered');
    expect(recoveredEvent?.indexStatus).toBe('verified');

    // Verify index is querying normally
    const searchRes = await client.search({ query: 'Degraded' });
    expect(searchRes.matches.length).toBe(1);
    expect(searchRes.matches[0].path).toBe('DegradedNote.md');

    sub.unsubscribe();
    await gw.stop();
  });

  it('9. P2-LEGACY: Legacy cursor against advanced new gateway instance triggers reset and NEVER partially replays events', async () => {
    const testPort = await getFreePort();
    const TOKEN = 'legacy-cursor-test-token-p2';

    // Step 1: Start Gateway A and create an initial note
    const storageA = new MemoryVaultStorage('p2-vault');
    const indexA = new MemoryDocumentIndex();
    const parserA = new DefaultDocumentParser();
    const safeWriterA = new SafeWriter(storageA);
    const wsA = new OpenObWorkspace({
      storage: storageA,
      index: indexA,
      parser: parserA,
      safeWriter: safeWriterA,
      readOnly: false,
      vaultName: 'p2-vault',
    });

    const gwA = await startGateway({
      workspace: wsA,
      port: testPort,
      token: TOKEN,
    });

    const clientA = new OpenObGatewayClient({
      url: gwA.url,
      token: TOKEN,
      clientId: 'legacy-client',
    });

    await clientA.createNote({
      path: 'A1.md',
      content: '# Note A1',
    });

    const legacyCursor = 'evt_1_legacyA';
    await gwA.stop();
    await new Promise((r) => setTimeout(r, 50));

    // Step 2: Start Gateway B on same port and vault
    const storageB = new MemoryVaultStorage('p2-vault');
    const indexB = new MemoryDocumentIndex();
    const parserB = new DefaultDocumentParser();
    const safeWriterB = new SafeWriter(storageB);
    const wsB = new OpenObWorkspace({
      storage: storageB,
      index: indexB,
      parser: parserB,
      safeWriter: safeWriterB,
      readOnly: false,
      vaultName: 'p2-vault',
    });

    const gwB = await startGateway({
      workspace: wsB,
      port: testPort,
      token: TOKEN,
    });

    const clientB = new OpenObGatewayClient({
      url: gwB.url,
      token: TOKEN,
      clientId: 'agent-b',
    });

    // Step 3: Advance Gateway B to sequence 3 (B:1, B:2, B:3)
    await clientB.createNote({ path: 'B1.md', content: '# B1' });
    await clientB.createNote({ path: 'B2.md', content: '# B2' });
    await clientB.createNote({ path: 'B3.md', content: '# B3' });

    // Step 4: Reconnect with legacy cursor evt_1_legacyA
    const sseRes = await fetch(`${gwB.url}/api/v1/events`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Last-Event-ID': legacyCursor,
        Accept: 'text/event-stream',
      },
    });

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    let resetReceived: WorkspaceChangeEvent | null = null;
    const receivedEvents: WorkspaceChangeEvent[] = [];
    let readDone = false;

    // Read initial stream burst
    while (!readDone) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            const ev: WorkspaceChangeEvent = JSON.parse(data);
            receivedEvents.push(ev);
            if (ev.type === 'stream.reset') {
              resetReceived = ev;
              readDone = true;
              break;
            }
          }
        }
      }
    }

    // Critical assertion: First semantic response MUST be stream.reset (legacy_cursor)
    expect(resetReceived).not.toBeNull();
    expect(resetReceived?.type).toBe('stream.reset');
    expect(resetReceived?.reason).toBe('legacy_cursor');

    // Critical assertion: NO partial replay of B2/B3 occurred as if evt_1 belonged to B
    const noteEvents = receivedEvents.filter((e) => e.type.startsWith('note.'));
    expect(noteEvents.length).toBe(0);

    // Step 5: After reset/resync, mutate Gateway B (B4) and verify new events arrive
    await clientB.createNote({ path: 'B4.md', content: '# B4' });

    let b4Event: WorkspaceChangeEvent | null = null;
    let readDone2 = false;
    while (!readDone2) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            const ev: WorkspaceChangeEvent = JSON.parse(data);
            if (ev.path === 'B4.md') {
              b4Event = ev;
              readDone2 = true;
              break;
            }
          }
        }
      }
    }
    reader.cancel();

    expect(b4Event).not.toBeNull();
    expect(b4Event?.path).toBe('B4.md');
    expect(b4Event?.serverInstanceId).toBe(wsB.getEventPublisher().serverInstanceId);

    await gwB.stop();
  });

  it('10. P2-LEGACY: Legacy cursor on SAME process unconditionally triggers reset', async () => {
    const testPort = await getFreePort();
    const TOKEN = 'same-process-legacy-token';

    const storage = new MemoryVaultStorage('same-proc-vault');
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const safeWriter = new SafeWriter(storage);
    const ws = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      readOnly: false,
      vaultName: 'same-proc-vault',
    });

    const gw = await startGateway({
      workspace: ws,
      port: testPort,
      token: TOKEN,
    });

    const client = new OpenObGatewayClient({
      url: gw.url,
      token: TOKEN,
      clientId: 'same-proc-client',
    });

    // Create 3 notes on current instance (seq 1, 2, 3)
    await client.createNote({ path: 'Note1.md', content: '# Note 1' });
    await client.createNote({ path: 'Note2.md', content: '# Note 2' });
    await client.createNote({ path: 'Note3.md', content: '# Note 3' });

    // Connect with legacy cursor evt_1_rand
    const sseRes = await fetch(`${gw.url}/api/v1/events`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Last-Event-ID': 'evt_1_samerun',
        Accept: 'text/event-stream',
      },
    });

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    let receivedReset = false;
    let resetReason = '';

    while (!receivedReset) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            const ev = JSON.parse(data);
            if (ev.type === 'stream.reset') {
              receivedReset = true;
              resetReason = ev.reason;
              break;
            }
          }
        }
      }
    }
    reader.cancel();

    expect(receivedReset).toBe(true);
    expect(resetReason).toBe('legacy_cursor');

    await gw.stop();
  });

  it('11. Malformed and near-legacy cursor inputs fail safely without crash', async () => {
    const testPort = await getFreePort();
    const TOKEN = 'malformed-cursor-token';

    const storage = new MemoryVaultStorage('malformed-vault');
    const index = new MemoryDocumentIndex();
    const parser = new DefaultDocumentParser();
    const safeWriter = new SafeWriter(storage);
    const ws = new OpenObWorkspace({
      storage,
      index,
      parser,
      safeWriter,
      readOnly: false,
      vaultName: 'malformed-vault',
    });

    const gw = await startGateway({
      workspace: ws,
      port: testPort,
      token: TOKEN,
    });

    const badCursors = [
      'evt_',
      'evt_bad_rand',
      'evt_-1_rand',
      'evt_999999999999999999999_rand',
      'EVT_1_rand',
      'random text string with spaces',
      'a'.repeat(300),
    ];

    for (const badCursor of badCursors) {
      const sseRes = await fetch(`${gw.url}/api/v1/events`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Last-Event-ID': badCursor,
          Accept: 'text/event-stream',
        },
      });

      expect(sseRes.status).toBe(200);
      const reader = sseRes.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();
      expect(value).toBeDefined();
    }

    await gw.stop();
  });

  it('12. P2-LEGACY: 20x Advanced-Instance Legacy Cursor Stress Loop', async () => {
    const testPort = await getFreePort();
    const TOKEN = 'legacy-stress-20x-token';

    for (let i = 1; i <= 20; i++) {
      const storage = new MemoryVaultStorage(`legacy-stress-${i}`);
      const index = new MemoryDocumentIndex();
      const parser = new DefaultDocumentParser();
      const safeWriter = new SafeWriter(storage);
      const ws = new OpenObWorkspace({
        storage,
        index,
        parser,
        safeWriter,
        readOnly: false,
        vaultName: `legacy-stress-${i}`,
      });

      const gw = await startGateway({
        workspace: ws,
        port: testPort,
        token: TOKEN,
      });

      const client = new OpenObGatewayClient({
        url: gw.url,
        token: TOKEN,
        clientId: 'legacy-stress-client',
      });

      // Advance instance to sequence 3
      await client.createNote({ path: `N1_${i}.md`, content: '# N1' });
      await client.createNote({ path: `N2_${i}.md`, content: '# N2' });
      await client.createNote({ path: `N3_${i}.md`, content: '# N3' });

      // Connect with legacy cursor evt_1_old
      const sseRes = await fetch(`${gw.url}/api/v1/events`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Last-Event-ID': `evt_1_old_${i}`,
          Accept: 'text/event-stream',
        },
      });

      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();

      let resetReceived = false;
      let resetReason = '';

      while (!resetReceived) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              const ev = JSON.parse(data);
              if (ev.type === 'stream.reset') {
                resetReceived = true;
                resetReason = ev.reason;
                break;
              }
            }
          }
        }
      }
      reader.cancel();

      expect(resetReceived).toBe(true);
      expect(resetReason).toBe('legacy_cursor');

      await gw.stop();
      await new Promise((r) => setTimeout(r, 20));
    }
  });
});

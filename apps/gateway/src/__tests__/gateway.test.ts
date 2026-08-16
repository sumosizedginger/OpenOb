import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryVaultStorage } from '@okw/vault';
import { OpenObWorkspace } from '@okw/workspace';
import { runCli } from '../cli.js';
import { RunningGateway, startGateway } from '../server.js';

describe('OpenOb Gateway REST API & Security Tests (@okw/gateway)', () => {
  let gateway: RunningGateway;
  let workspace: OpenObWorkspace;
  const TEST_TOKEN = 'secret-test-token-xyz-123';

  beforeAll(async () => {
    const storage = new MemoryVaultStorage('gateway-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    // Seed notes
    const welcome = `---
title: Welcome Gateway
aliases: [Welcome Gateway]
tags: [gateway, api]
category: guide
---
# Welcome to Gateway

This is an API test note. Check out [[Folder/Sub Note]] and [[Notes/日本語]].
`;

    const subNote = `---
title: Sub Note
tags: [sub, doc]
---
# Sub Note

Links back to [[Welcome Gateway]].
`;

    const unicodeNote = `---
title: 日本語ノート
tags: [unicode, test]
---
# 日本語タイトル

Unicode test content with spaces and symbols.
`;

    const noteWithSpaces = `# Note With Spaces

Linked from nowhere.
`;

    const subBacklinksNote = `# Subfolder Backlinks Note

This note is literally named backlinks inside a subfolder.
`;

    const s1 = (await storage.write('Welcome.md', null, welcome)).snapshot;
    const s2 = (await storage.write('Folder/Sub Note.md', null, subNote)).snapshot;
    const s3 = (await storage.write('Notes/日本語.md', null, unicodeNote)).snapshot;
    const s4 = (await storage.write('Folder With Spaces/Note Space.md', null, noteWithSpaces))
      .snapshot;
    const s5 = (await storage.write('Sub/backlinks.md', null, subBacklinksNote)).snapshot;

    await index.upsert(await parser.parse('Welcome.md', s1.textContent!, s1.version.hash));
    await index.upsert(await parser.parse('Folder/Sub Note.md', s2.textContent!, s2.version.hash));
    await index.upsert(await parser.parse('Notes/日本語.md', s3.textContent!, s3.version.hash));
    await index.upsert(
      await parser.parse('Folder With Spaces/Note Space.md', s4.textContent!, s4.version.hash)
    );
    await index.upsert(await parser.parse('Sub/backlinks.md', s5.textContent!, s5.version.hash));

    workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      vaultName: 'gateway-vault',
      readOnly: true,
    });

    gateway = await startGateway({
      workspace,
      host: '127.0.0.1',
      port: 0, // dynamic port for clean test isolation
      token: TEST_TOKEN,
    });
  });

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
    }
  });

  async function apiFetch(path: string, options: RequestInit = {}) {
    const url = `${gateway.url}${path}`;
    const headers = new Headers(options.headers || {});
    if (
      !headers.has('Authorization') &&
      !headers.has('X-OpenOb-Token') &&
      !headers.has('No-Auth')
    ) {
      headers.set('Authorization', `Bearer ${TEST_TOKEN}`);
    }
    headers.delete('No-Auth');
    return fetch(url, { ...options, headers });
  }

  it('1. GET /health is publicly accessible without authentication', async () => {
    const res = await fetch(`${gateway.url}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.readOnly).toBe(true);
    expect(data.version).toBe('0.1.0');
    expect(data.vault).toBe('gateway-vault');
  });

  it('2. Authentication: missing or invalid token rejects with 401 UNAUTHORIZED', async () => {
    // Missing token
    const resMissing = await fetch(`${gateway.url}/api/v1/workspace`);
    expect(resMissing.status).toBe(401);
    const err1 = await resMissing.json();
    expect(err1.code).toBe('UNAUTHORIZED');

    // Wrong token
    const resWrong = await fetch(`${gateway.url}/api/v1/workspace`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(resWrong.status).toBe(401);
    const err2 = await resWrong.json();
    expect(err2.code).toBe('UNAUTHORIZED');

    // Valid token via Bearer header
    const resBearer = await apiFetch('/api/v1/workspace');
    expect(resBearer.status).toBe(200);

    // Valid token via X-OpenOb-Token header
    const resHeader = await fetch(`${gateway.url}/api/v1/workspace`, {
      headers: { 'X-OpenOb-Token': TEST_TOKEN },
    });
    expect(resHeader.status).toBe(200);
  });

  it('3. GET /api/v1/workspace returns accurate workspace metadata', async () => {
    const res = await apiFetch('/api/v1/workspace');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('gateway-vault');
    expect(data.apiVersion).toBe('v1');
    expect(data.noteCount).toBe(5);
    expect(data.readOnly).toBe(true);
    expect(data.capabilities).toContain('workspace.read');
  });

  it('4. GET /api/v1/entries lists directory contents', async () => {
    const resRoot = await apiFetch('/api/v1/entries');
    expect(resRoot.status).toBe(200);
    const rootEntries = await resRoot.json();
    expect(rootEntries.some((e: any) => e.path === 'Welcome.md')).toBe(true);

    const resSub = await apiFetch('/api/v1/entries?path=Folder');
    expect(resSub.status).toBe(200);
    const subEntries = await resSub.json();
    expect(subEntries.some((e: any) => e.name === 'Sub Note.md')).toBe(true);
  });

  it('5. GET /api/v1/notes/:path reads note with full metadata', async () => {
    const res = await apiFetch('/api/v1/notes/Welcome.md');
    expect(res.status).toBe(200);
    const note = await res.json();
    expect(note.path).toBe('Welcome.md');
    expect(note.title).toBe('Welcome Gateway');
    expect(note.properties.category).toBe('guide');
    expect(note.tags).toEqual(['gateway', 'api']);
    expect(note.links).toHaveLength(2);
    expect(note.textContent).toContain('This is an API test note');
  });

  it('6. GET /api/v1/notes/:path supports nested, spaces, and Unicode paths', async () => {
    // Nested note with space
    const resNested = await apiFetch(`/api/v1/notes/${encodeURIComponent('Folder/Sub Note.md')}`);
    expect(resNested.status).toBe(200);
    const noteNested = await resNested.json();
    expect(noteNested.title).toBe('Sub Note');

    // Unicode note
    const resUnicode = await apiFetch(`/api/v1/notes/${encodeURIComponent('Notes/日本語.md')}`);
    expect(resUnicode.status).toBe(200);
    const noteUnicode = await resUnicode.json();
    expect(noteUnicode.title).toBe('日本語ノート');
    expect(noteUnicode.tags).toContain('unicode');

    // Folder and note with spaces
    const resSpace = await apiFetch(
      `/api/v1/notes/${encodeURIComponent('Folder With Spaces/Note Space.md')}`
    );
    expect(resSpace.status).toBe(200);
    const noteSpace = await resSpace.json();
    expect(noteSpace.title).toBe('Note With Spaces');
  });

  it('7. GET /api/v1/search executes lexical queries and filters', async () => {
    const resQuery = await apiFetch('/api/v1/search?q=Gateway');
    expect(resQuery.status).toBe(200);
    const searchData = await resQuery.json();
    expect(searchData.total).toBe(2); // Welcome.md + Sub Note.md (via wikilink body)

    const resTag = await apiFetch('/api/v1/search?q=日本語&tags=unicode');
    expect(resTag.status).toBe(200);
    const tagData = await resTag.json();
    expect(tagData.total).toBe(1);
    expect(tagData.matches[0].path).toBe('Notes/日本語.md');
  });

  it('8. Subaction routes: backlinks, links, properties, graph-neighbors', async () => {
    // Backlinks to Welcome.md (from Folder/Sub Note.md)
    const resBacklinks = await apiFetch('/api/v1/notes/Welcome.md/backlinks');
    expect(resBacklinks.status).toBe(200);
    const backlinks = await resBacklinks.json();
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourcePath).toBe('Folder/Sub Note.md');

    // Outgoing links from Welcome.md
    const resLinks = await apiFetch('/api/v1/notes/Welcome.md/links');
    expect(resLinks.status).toBe(200);
    const links = await resLinks.json();
    expect(links).toHaveLength(2);
    expect(links.some((l: any) => l.targetPath === 'Folder/Sub Note.md')).toBe(true);

    // Properties of Welcome.md
    const resProps = await apiFetch('/api/v1/notes/Welcome.md/properties');
    expect(resProps.status).toBe(200);
    const props = await resProps.json();
    expect(props.properties.category).toBe('guide');

    // Graph neighbors of Welcome.md
    const resGraph = await apiFetch('/api/v1/notes/Welcome.md/graph-neighbors');
    expect(resGraph.status).toBe(200);
    const graph = await resGraph.json();
    expect(graph.title).toBe('Welcome Gateway');
    expect(graph.incoming).toHaveLength(1);
    expect(graph.outgoing).toHaveLength(2);
    expect(graph.neighbors.some((n: any) => n.path === 'Folder/Sub Note.md')).toBe(true);
  });

  it('9. Security & Path Traversal: all escape attempts rejected with 400 INVALID_PATH', async () => {
    // ../ traversal
    const res1 = await apiFetch(`/api/v1/notes/${encodeURIComponent('../secret.md')}`);
    expect(res1.status).toBe(400);
    const err1 = await res1.json();
    expect(err1.code).toBe('INVALID_PATH');

    // Nested double traversal
    const res2 = await apiFetch(`/api/v1/notes/${encodeURIComponent('Folder/../../etc/passwd')}`);
    expect(res2.status).toBe(400);
    const err2 = await res2.json();
    expect(err2.code).toBe('INVALID_PATH');

    // Windows drive letter
    const res3 = await apiFetch(`/api/v1/notes/${encodeURIComponent('C:/Windows/system32')}`);
    expect(res3.status).toBe(400);
    const err3 = await res3.json();
    expect(err3.code).toBe('INVALID_PATH');

    // Traversal in entries query
    const res4 = await apiFetch('/api/v1/entries?path=../');
    expect(res4.status).toBe(400);
    const err4 = await res4.json();
    expect(err4.code).toBe('INVALID_PATH');
  });

  it('10. Missing note returns 404 NOT_FOUND', async () => {
    const res = await apiFetch('/api/v1/notes/NonExistentNote.md');
    expect(res.status).toBe(404);
    const err = await res.json();
    expect(err.code).toBe('NOT_FOUND');
  });

  it('11. Mutating HTTP methods are rejected with 405 UNSUPPORTED in Phase 1', async () => {
    const resPost = await apiFetch('/api/v1/notes/New.md', { method: 'POST' });
    expect(resPost.status).toBe(405);
    const errPost = await resPost.json();
    expect(errPost.code).toBe('UNSUPPORTED');

    const resDelete = await apiFetch('/api/v1/notes/Welcome.md', { method: 'DELETE' });
    expect(resDelete.status).toBe(405);
    const errDelete = await resDelete.json();
    expect(errDelete.code).toBe('UNSUPPORTED');
  });

  it('12. CLI runner executes read-only commands with JSON and text output', async () => {
    const infoCli = await runCli({ workspace, args: ['info', '--json'] });
    expect(infoCli.exitCode).toBe(0);
    const infoJson = JSON.parse(infoCli.output);
    expect(infoJson.name).toBe('gateway-vault');

    const listCli = await runCli({ workspace, args: ['list'] });
    expect(listCli.exitCode).toBe(0);
    expect(listCli.output).toContain('Welcome.md');

    const readCli = await runCli({ workspace, args: ['read', 'Welcome.md'] });
    expect(readCli.exitCode).toBe(0);
    expect(readCli.output).toContain('This is an API test note');

    const searchCli = await runCli({ workspace, args: ['search', 'Gateway', '--json'] });
    expect(searchCli.exitCode).toBe(0);
    const searchJson = JSON.parse(searchCli.output);
    expect(searchJson.total).toBe(2);

    const backlinksCli = await runCli({ workspace, args: ['backlinks', 'Welcome.md'] });
    expect(backlinksCli.exitCode).toBe(0);
    expect(backlinksCli.output).toContain('Folder/Sub Note.md');
  });

  it('13. Performance: gateway REST requests resolve with low latency (<50ms)', async () => {
    const t0 = Date.now();
    const res1 = await apiFetch('/api/v1/workspace');
    expect(res1.status).toBe(200);
    const d1 = Date.now() - t0;
    expect(d1).toBeLessThan(50);

    const t1 = Date.now();
    const res2 = await apiFetch('/api/v1/notes/Welcome.md');
    expect(res2.status).toBe(200);
    const d2 = Date.now() - t1;
    expect(d2).toBeLessThan(50);

    const t2 = Date.now();
    const res3 = await apiFetch('/api/v1/search?q=Gateway');
    expect(res3.status).toBe(200);
    const d3 = Date.now() - t2;
    expect(d3).toBeLessThan(50);
  });

  it('14. E1: Error responses never leak absolute filesystem paths or raw stacks', async () => {
    // Construct workspace with a failing storage that returns absolute paths in error messages
    const failingStorage = {
      name: 'failing-vault',
      async list() {
        return [];
      },
      async read() {
        throw new Error(
          "Failed to read 'Welcome.md': EACCES: permission denied, open 'C:\\Users\\Secret\\Vault\\Welcome.md'"
        );
      },
      async readText() {
        throw new Error('EACCES open /root/secrets/vault/Welcome.md');
      },
      async write() {
        throw new Error('Storage write disabled');
      },
      async remove() {
        throw new Error('Storage remove disabled');
      },
      async exists() {
        return true;
      },
      async stat() {
        return null;
      },
      async rename() {},
      on() {
        return () => {};
      },
    };

    const failingWorkspace = new OpenObWorkspace({
      storage: failingStorage as any,
      index: new MemoryDocumentIndex(),
      parser: new DefaultDocumentParser(),
      vaultName: 'failing-vault',
    });

    const failingGateway = await startGateway({
      workspace: failingWorkspace,
      port: 0,
    });

    try {
      const res = await fetch(`${failingGateway.url}/api/v1/notes/Welcome.md`);
      expect(res.status).toBe(500);
      const data = await res.json();

      expect(data.code).toBe('INTERNAL_ERROR');
      // Assert absolute paths and stack traces are completely absent
      const rawBody = JSON.stringify(data);
      expect(rawBody).not.toContain('C:\\Users');
      expect(rawBody).not.toContain('/root/secrets');
      expect(rawBody).not.toContain('EACCES');
      expect(data.message).toBe('An internal error occurred');
    } finally {
      await failingGateway.stop();
    }
  });

  it('15. E4: Note named like subactions (Sub/backlinks.md) is read as note, while Welcome.md/backlinks reads backlinks', async () => {
    // 1. Read note literally named Sub/backlinks.md
    const noteRes = await apiFetch(`/api/v1/notes/${encodeURIComponent('Sub/backlinks.md')}`);
    expect(noteRes.status).toBe(200);
    const noteData = await noteRes.json();
    expect(noteData.path).toBe('Sub/backlinks.md');
    expect(noteData.textContent).toContain('This note is literally named backlinks');

    // 2. Query backlinks of Welcome.md
    const backlinksRes = await apiFetch('/api/v1/notes/Welcome.md/backlinks');
    expect(backlinksRes.status).toBe(200);
    const backlinksData = await backlinksRes.json();
    expect(backlinksData).toHaveLength(1);
    expect(backlinksData[0].sourcePath).toBe('Folder/Sub Note.md');
  });

  it('16. E2: Gateway CLI argument parsing parses vault, port, and token correctly', async () => {
    const { parseGatewayArgs } = await import('../bin/gateway.js');
    const parsed = parseGatewayArgs([
      '--vault',
      './test-vault-dir',
      '--port',
      '5555',
      '--host',
      '127.0.0.1',
      '--token',
      'custom-secret-token',
    ]);

    expect(parsed.vaultPath).toBe('./test-vault-dir');
    expect(parsed.port).toBe(5555);
    expect(parsed.host).toBe('127.0.0.1');
    expect(parsed.token).toBe('custom-secret-token');
  });
});

import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryVaultStorage } from '@okw/vault';
import { handleMcpToolCall, OpenObWorkspace } from '@okw/workspace';
import { runCli } from '../cli.js';
import { RunningGateway, startGateway } from '../server.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('OpenOb Gateway REST API & Security Tests (@okw/gateway)', () => {
  let gateway: RunningGateway;
  let workspace: OpenObWorkspace;
  let tempDist: string;
  let cliBinPath: string;
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

    // 1. Build an isolated production gateway artifact specifically for CLI process tests
    const { execFile } = await import('node:child_process');
    const path = await import('node:path');
    const BUILD_SCRIPT = path.resolve(__dirname, '../../build.js');
    tempDist = path.resolve(
      __dirname,
      `../../.dist-gw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [BUILD_SCRIPT, '--outdir', tempDist], (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Failed to build isolated gateway CLI: ${stderr || stdout}`));
        } else {
          resolve();
        }
      });
    });
    cliBinPath = path.join(tempDist, 'bin/cli.js');
  });

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
    }
    if (tempDist) {
      const fs = await import('node:fs/promises');
      await fs.rm(tempDist, { recursive: true, force: true }).catch(() => {});
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

  it('11. Mutating HTTP methods on read-only endpoints are rejected with 405 UNSUPPORTED', async () => {
    const resPost = await apiFetch('/api/v1/entries', { method: 'POST' });
    expect(resPost.status).toBe(405);
    const errPost = await resPost.json();
    expect(errPost.code).toBe('UNSUPPORTED');

    const resDelete = await apiFetch('/api/v1/workspace', { method: 'DELETE' });
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

  it('17. Enforce Loopback-Only: non-loopback hosts (0.0.0.0, ::, LAN) are rejected', async () => {
    // 0.0.0.0
    await expect(
      startGateway({
        workspace,
        host: '0.0.0.0',
        port: 0,
      })
    ).rejects.toThrow(/Gateway can only bind to loopback interfaces/);

    // :: (all IPv6)
    await expect(
      startGateway({
        workspace,
        host: '::',
        port: 0,
      })
    ).rejects.toThrow(/Gateway can only bind to loopback interfaces/);

    // Non-loopback LAN IP
    await expect(
      startGateway({
        workspace,
        host: '192.168.1.100',
        port: 0,
      })
    ).rejects.toThrow(/Gateway can only bind to loopback interfaces/);

    // 10.0.0.1
    await expect(
      startGateway({
        workspace,
        host: '10.0.0.1',
        port: 0,
      })
    ).rejects.toThrow(/Gateway can only bind to loopback interfaces/);
  });

  it('18. Remote CLI Mode: CLI communicates strictly via REST with running gateway', async () => {
    // Info via REST
    const infoRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['info', '--json'],
    });
    expect(infoRes.exitCode).toBe(0);
    const infoData = JSON.parse(infoRes.output);
    expect(infoData.name).toBe('gateway-vault');
    expect(infoData.readOnly).toBe(true);

    // List via REST
    const listRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['list'],
    });
    expect(listRes.exitCode).toBe(0);
    expect(listRes.output).toContain('Welcome.md');

    // Read via REST
    const readRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['read', 'Welcome.md'],
    });
    expect(readRes.exitCode).toBe(0);
    expect(readRes.output).toContain('This is an API test note');

    // Search via REST
    const searchRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['search', 'Gateway', '--json'],
    });
    expect(searchRes.exitCode).toBe(0);
    const searchData = JSON.parse(searchRes.output);
    expect(searchData.total).toBe(2);

    // Backlinks via REST
    const backlinksRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['backlinks', 'Welcome.md'],
    });
    expect(backlinksRes.exitCode).toBe(0);
    expect(backlinksRes.output).toContain('Folder/Sub Note.md');

    // Invalid Token via REST -> fails with Unauthorized
    const unauthRes = await runCli({
      url: gateway.url,
      token: 'bad-token',
      args: ['info'],
    });
    expect(unauthRes.exitCode).toBe(1);
    expect(unauthRes.output).toContain('Unauthorized');

    // Unreachable Gateway -> fails with clear error message
    const unreachableRes = await runCli({
      url: 'http://127.0.0.1:59998',
      token: TEST_TOKEN,
      args: ['info'],
    });
    expect(unreachableRes.exitCode).toBe(1);
    expect(unreachableRes.output).toContain('Unable to connect to OpenOb Gateway');
  });

  it('19. CLI argument parser parses url and token options', async () => {
    const { parseCliArgs } = await import('../bin/cli.js');
    const parsed = parseCliArgs([
      '--url',
      'http://127.0.0.1:9999',
      '--token',
      'my-cli-token',
      'read',
      'Note.md',
    ]);

    expect(parsed.url).toBe('http://127.0.0.1:9999');
    expect(parsed.token).toBe('my-cli-token');
    expect(parsed.commandArgs).toEqual(['read', 'Note.md']);
  });

  it('20. Clean State Executable Test: Spawns built CLI executable as real process', async () => {
    const { execFile } = await import('node:child_process');
    const fs = await import('node:fs/promises');

    // 1. Verify that cliBinPath is the self-contained esbuild bundle (does not contain unbundled relative package src imports)
    const cliSource = await fs.readFile(cliBinPath, 'utf8');
    expect(cliSource).not.toMatch(/from\s+['"][^'"]*packages\/[^'"]*\/src/);

    // 2. Run `node <cliBinPath> --url <gateway.url> --token <TEST_TOKEN> info --json`
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [cliBinPath, '--url', gateway.url, '--token', TEST_TOKEN, 'info', '--json'],
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`CLI exit with code ${err.code}: ${stderr || stdout}`));
          } else {
            resolve(stdout);
          }
        }
      );
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe('gateway-vault');
    expect(parsed.readOnly).toBe(true);
    expect(parsed.noteCount).toBe(5);
  });

  it('21. CLI help semantics: help, --help, -h, no-command exit 0; unknown command exits 1', async () => {
    // 1. --help exits 0
    const helpFlagRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['--help'],
    });
    expect(helpFlagRes.exitCode).toBe(0);
    expect(helpFlagRes.output).toContain('OpenOb Local CLI');

    // 2. -h exits 0
    const shortHelpRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['-h'],
    });
    expect(shortHelpRes.exitCode).toBe(0);
    expect(shortHelpRes.output).toContain('OpenOb Local CLI');

    // 3. help command exits 0
    const helpCmdRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['help'],
    });
    expect(helpCmdRes.exitCode).toBe(0);
    expect(helpCmdRes.output).toContain('OpenOb Local CLI');

    // 4. empty command (no args) exits 0
    const noCmdRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: [],
    });
    expect(noCmdRes.exitCode).toBe(0);
    expect(noCmdRes.output).toContain('OpenOb Local CLI');

    // 5. unknown command exits 1 with error
    const unknownRes = await runCli({
      url: gateway.url,
      token: TEST_TOKEN,
      args: ['foobar-command'],
    });
    expect(unknownRes.exitCode).toBe(1);
    expect(unknownRes.output).toContain('Unknown command "foobar-command"');
  });

  it('22. Scope Enforcement: Default read-only gateway rejects POST, PUT, PATCH with 403 Forbidden', async () => {
    // 1. POST /api/v1/notes
    const postRes = await fetch(`${gateway.url}/api/v1/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: 'ReadOnlyCreate.md', content: 'test' }),
    });
    expect(postRes.status).toBe(403);
    const postErr = await postRes.json();
    expect(postErr.code).toBe('FORBIDDEN');

    // 2. PUT /api/v1/notes/Welcome.md
    const putRes = await fetch(`${gateway.url}/api/v1/notes/Welcome.md`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'new',
        expectedVersion: { token: 'mock' },
      }),
    });
    expect(putRes.status).toBe(403);

    // 3. Forged scopes header is ignored
    const forgedRes = await fetch(`${gateway.url}/api/v1/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
        'X-OpenOb-Scopes': 'workspace.write,properties.write',
      },
      body: JSON.stringify({ path: 'Forged.md', content: 'test' }),
    });
    expect(forgedRes.status).toBe(403);
  });

  it('23. Writable Gateway: Full Mutation Lifecycle (Create -> Read -> Update -> Set-Property -> Conflict)', async () => {
    // Start a writable gateway instance
    const writePort = await getFreePort();
    const writeGateway = await startGateway({
      workspace: new OpenObWorkspace({
        storage: new MemoryVaultStorage('writable-vault'),
        index: new MemoryDocumentIndex(),
        vaultName: 'writable-vault',
        readOnly: false,
      }),
      port: writePort,
      token: 'write-token',
      scopes: ['workspace.read', 'workspace.search', 'workspace.write', 'properties.write'],
    });

    try {
      // 1. POST /api/v1/notes -> 201 Created
      const createRes = await fetch(`${writeGateway.url}/api/v1/notes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer write-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: 'CreatedNote.md',
          content: 'Hello World',
          properties: { status: 'draft' },
        }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      expect(createData.durableSuccess).toBe(true);
      expect(createData.currentVersion.token).toBeDefined();

      const v1 = createData.currentVersion;

      // 2. GET /api/v1/notes/CreatedNote.md -> 200 OK
      const readRes = await fetch(`${writeGateway.url}/api/v1/notes/CreatedNote.md`, {
        headers: { Authorization: 'Bearer write-token' },
      });
      expect(readRes.status).toBe(200);
      const readData = await readRes.json();
      expect(readData.textContent).toContain('Hello World');
      expect(readData.properties.status).toBe('draft');

      // 3. PUT /api/v1/notes/CreatedNote.md -> 200 OK
      const updateRes = await fetch(`${writeGateway.url}/api/v1/notes/CreatedNote.md`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer write-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Updated Content V2',
          expectedVersion: v1,
        }),
      });
      expect(updateRes.status).toBe(200);
      const updateData = await updateRes.json();
      expect(updateData.currentVersion.token).not.toBe(v1.token);

      const v2 = updateData.currentVersion;

      // 4. Stale PUT using v1 -> 409 Conflict
      const staleRes = await fetch(`${writeGateway.url}/api/v1/notes/CreatedNote.md`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer write-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Stale Content',
          expectedVersion: v1,
        }),
      });
      expect(staleRes.status).toBe(409);
      const staleData = await staleRes.json();
      expect(staleData.code).toBe('CONFLICT');

      // 5. PATCH /api/v1/notes/CreatedNote.md/properties -> 200 OK
      const propRes = await fetch(`${writeGateway.url}/api/v1/notes/CreatedNote.md/properties`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer write-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: 'status',
          value: 'published',
          expectedVersion: v2,
        }),
      });
      expect(propRes.status).toBe(200);
      const propData = await propRes.json();
      expect(propData.operation).toBe('set_property');
    } finally {
      await writeGateway.stop();
    }
  });

  it('24. CLI Mutation Commands via REST client against running gateway', async () => {
    const writePort = await getFreePort();
    const writeGateway = await startGateway({
      workspace: new OpenObWorkspace({
        storage: new MemoryVaultStorage('cli-vault'),
        index: new MemoryDocumentIndex(),
        vaultName: 'cli-vault',
        readOnly: false,
      }),
      port: writePort,
      token: 'cli-token',
      scopes: ['workspace.read', 'workspace.search', 'workspace.write', 'properties.write'],
    });

    try {
      // 1. openob create
      const createCliRes = await runCli({
        url: writeGateway.url,
        token: 'cli-token',
        args: ['create', 'CliNote.md', '--content', 'Body from CLI', '--json'],
      });
      expect(createCliRes.exitCode).toBe(0);
      const created = JSON.parse(createCliRes.output);
      expect(created.path).toBe('CliNote.md');

      const v1Token = created.currentVersion.token;

      // 2. openob update
      const updateCliRes = await runCli({
        url: writeGateway.url,
        token: 'cli-token',
        args: [
          'update',
          'CliNote.md',
          '--expected-version',
          v1Token,
          '--content',
          'Updated from CLI',
          '--json',
        ],
      });
      expect(updateCliRes.exitCode).toBe(0);
      const updated = JSON.parse(updateCliRes.output);
      expect(updated.currentVersion.token).not.toBe(v1Token);

      // 3. openob set-property
      const propCliRes = await runCli({
        url: writeGateway.url,
        token: 'cli-token',
        args: [
          'set-property',
          'CliNote.md',
          'rating',
          '5',
          '--expected-version',
          updated.currentVersion.token,
          '--json',
        ],
      });
      expect(propCliRes.exitCode).toBe(0);
    } finally {
      await writeGateway.stop();
    }
  });

  it('25. MCP Mutation Handlers: openob_create_note, openob_update_note, openob_set_property', async () => {
    const ws = new OpenObWorkspace({
      storage: new MemoryVaultStorage('mcp-vault'),
      index: new MemoryDocumentIndex(),
      readOnly: false,
    });

    // 1. openob_create_note
    const createToolRes = await handleMcpToolCall(
      ws,
      'openob_create_note',
      {
        path: 'McpNote.md',
        content: 'MCP Created Content',
        properties: { topic: 'agents' },
      },
      { scopes: ['workspace.write'] }
    );
    expect(createToolRes.isError).toBeFalsy();
    const createParsed = JSON.parse(createToolRes.content[0].text);
    expect(createParsed.path).toBe('McpNote.md');

    // 2. openob_update_note
    const updateToolRes = await handleMcpToolCall(
      ws,
      'openob_update_note',
      {
        path: 'McpNote.md',
        content: 'MCP Updated Content',
        expectedVersion: createParsed.currentVersion,
      },
      { scopes: ['workspace.write'] }
    );
    expect(updateToolRes.isError).toBeFalsy();

    // 3. openob_set_property
    const propToolRes = await handleMcpToolCall(
      ws,
      'openob_set_property',
      {
        path: 'McpNote.md',
        key: 'topic',
        value: 'advanced-agents',
        expectedVersion: JSON.parse(updateToolRes.content[0].text).currentVersion,
      },
      { scopes: ['properties.write'] }
    );
    expect(propToolRes.isError).toBeFalsy();
  });

  it('26. Security: Malformed JSON, oversized body, and invalid HTTP methods', async () => {
    // 1. Malformed JSON -> 400
    const malformedRes = await fetch(`${gateway.url}/api/v1/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: 'this is not json {',
    });
    expect(malformedRes.status).toBe(400);
    const malformedData = await malformedRes.json();
    expect(malformedData.code).toBe('INVALID_REQUEST');

    // 2. DELETE method without workspace.delete scope -> 403 FORBIDDEN
    const deleteRes = await fetch(`${gateway.url}/api/v1/notes/Welcome.md`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'If-Match': '"tok-123"',
      },
    });
    expect(deleteRes.status).toBe(403);
  });

  it('27. P2A-1: Oversized REST request bodies reliably return HTTP 413 PAYLOAD_TOO_LARGE without ECONNRESET', async () => {
    const limitedStorage = new MemoryVaultStorage('limited-vault');
    const limitedParser = new DefaultDocumentParser();
    const limitedIndex = new MemoryDocumentIndex();
    const limitedWs = new OpenObWorkspace({
      storage: limitedStorage,
      parser: limitedParser,
      index: limitedIndex,
      vaultName: 'limited-vault',
      readOnly: false,
    });

    const limitedGateway = await startGateway({
      workspace: limitedWs,
      host: '127.0.0.1',
      port: 0,
      token: 'limited-token',
      scopes: ['workspace.write', 'properties.write'],
      maxBodyBytes: 1024, // 1 KB limit
    });

    try {
      // 1. Request with Content-Length exceeding maxBodyBytes -> 413
      const oversizedPayload = JSON.stringify({
        path: 'TooBig1.md',
        content: 'x'.repeat(2048),
      });

      const clRes = await fetch(`${limitedGateway.url}/api/v1/notes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer limited-token',
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(oversizedPayload)),
        },
        body: oversizedPayload,
      });
      expect(clRes.status).toBe(413);
      const clData = await clRes.json();
      expect(clData.code).toBe('PAYLOAD_TOO_LARGE');
      expect(clData.message).toContain('exceeds maximum');

      // Verify file was NOT created on disk/storage
      const stat1 = await limitedStorage.stat('TooBig1.md');
      expect(stat1).toBeNull();

      // 2. Streamed / chunked request exceeding maxBodyBytes -> 413 without socket crash
      const streamedPayload = JSON.stringify({
        path: 'TooBig2.md',
        content: 'y'.repeat(4096),
      });

      const chunkedRes = await fetch(`${limitedGateway.url}/api/v1/notes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer limited-token',
          'Content-Type': 'application/json',
        },
        body: streamedPayload,
      });
      expect(chunkedRes.status).toBe(413);
      const chunkedData = await chunkedRes.json();
      expect(chunkedData.code).toBe('PAYLOAD_TOO_LARGE');

      // Verify file was NOT created
      const stat2 = await limitedStorage.stat('TooBig2.md');
      expect(stat2).toBeNull();

      // 3. Request within limit (500 bytes) -> 201 Created
      const smallPayload = JSON.stringify({
        path: 'SmallNote.md',
        content: 'Valid content within 1KB limit.',
      });
      const validRes = await fetch(`${limitedGateway.url}/api/v1/notes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer limited-token',
          'Content-Type': 'application/json',
        },
        body: smallPayload,
      });
      expect(validRes.status).toBe(201);
      const validData = await validRes.json();
      expect(validData.path).toBe('SmallNote.md');
      expect(validData.durableSuccess).toBe(true);

      // 4. Verify gateway remains completely healthy and responsive
      const healthRes = await fetch(`${limitedGateway.url}/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.status).toBe('ok');
    } finally {
      await limitedGateway.stop();
    }
  });

  it('28. P3A-3: CLI set-property rejects flag-style misuse and validates positionals', async () => {
    const res = await runCli({
      workspace,
      args: [
        'set-property',
        'Welcome.md',
        '--key',
        'status',
        '--value',
        'active',
        '--expected-version',
        'v1',
      ],
    });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('Invalid or missing arguments');
    expect(res.output).toContain('Usage: openob set-property');
  });

  it('29. Phase 2B: REST Rename and Delete Note Endpoints with Concurrency Control', async () => {
    const structPort = await getFreePort();
    const structStorage = new MemoryVaultStorage('struct-vault');
    const structIndex = new MemoryDocumentIndex();
    const structWs = new OpenObWorkspace({
      storage: structStorage,
      index: structIndex,
      readOnly: false,
    });

    const structGateway = await startGateway({
      workspace: structWs,
      port: structPort,
      token: 'struct-token',
      scopes: [
        'workspace.read',
        'workspace.search',
        'workspace.write',
        'properties.write',
        'workspace.rename',
        'workspace.delete',
      ],
    });

    try {
      // 1. Create a note and backlink note
      const createRes = await fetch(`${structGateway.url}/api/v1/notes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer struct-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: 'OriginalNote.md',
          content: '# Original Body\nDetails here.',
        }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const origVersion = createData.currentVersion;

      await fetch(`${structGateway.url}/api/v1/notes`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer struct-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: 'Referrer.md',
          content: 'Reference to [[OriginalNote]] in text.',
        }),
      });

      // 2. Rename note via POST /api/v1/notes/:path/rename
      const renameRes = await fetch(`${structGateway.url}/api/v1/notes/OriginalNote.md/rename`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer struct-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPath: 'RenamedNote.md',
          expectedVersion: origVersion,
          updateLinks: true,
        }),
      });
      expect(renameRes.status).toBe(200);
      const renameData = await renameRes.json();
      expect(renameData.operation).toBe('rename');
      expect(renameData.oldPath).toBe('OriginalNote.md');
      expect(renameData.newPath).toBe('RenamedNote.md');
      expect(renameData.updatedFiles).toContain('Referrer.md');

      const renamedVersion = renameData.currentVersion;

      // 3. Verify referencing file updated
      const refRes = await fetch(`${structGateway.url}/api/v1/notes/Referrer.md`, {
        headers: { Authorization: 'Bearer struct-token' },
      });
      const refData = await refRes.json();
      expect(refData.textContent).toContain('[[RenamedNote]]');

      // 4. Stale delete attempt -> 409 CONFLICT
      const staleDelRes = await fetch(`${structGateway.url}/api/v1/notes/RenamedNote.md`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer struct-token',
          'If-Match': `"${origVersion.token}"`, // STALE
        },
      });
      expect(staleDelRes.status).toBe(409);

      // 5. Valid delete via DELETE /api/v1/notes/:path with If-Match header -> 200 OK
      const delRes = await fetch(`${structGateway.url}/api/v1/notes/RenamedNote.md`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer struct-token',
          'If-Match': `"${renamedVersion.token}"`,
        },
      });
      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.operation).toBe('delete');
      expect(delData.path).toBe('RenamedNote.md');

      // 6. Verify note is deleted -> 404 NOT_FOUND
      const checkDelRes = await fetch(`${structGateway.url}/api/v1/notes/RenamedNote.md`, {
        headers: { Authorization: 'Bearer struct-token' },
      });
      expect(checkDelRes.status).toBe(404);
    } finally {
      await structGateway.stop();
    }
  });

  it('30. Phase 2B: CLI rename and delete commands via REST gateway', async () => {
    const cliPort = await getFreePort();
    const cliStorage = new MemoryVaultStorage('cli-struct-vault');
    const cliIndex = new MemoryDocumentIndex();
    const cliWs = new OpenObWorkspace({
      storage: cliStorage,
      index: cliIndex,
      readOnly: false,
    });

    const cliGateway = await startGateway({
      workspace: cliWs,
      port: cliPort,
      token: 'cli-struct-token',
      scopes: [
        'workspace.read',
        'workspace.search',
        'workspace.write',
        'properties.write',
        'workspace.rename',
        'workspace.delete',
      ],
    });

    try {
      // 1. Create note
      const createCliRes = await runCli({
        url: cliGateway.url,
        token: 'cli-struct-token',
        args: ['create', 'CliToRename.md', '--content', 'Initial CLI note', '--json'],
      });
      expect(createCliRes.exitCode).toBe(0);
      const created = JSON.parse(createCliRes.output);

      // 2. Rename via CLI
      const renameCliRes = await runCli({
        url: cliGateway.url,
        token: 'cli-struct-token',
        args: [
          'rename',
          'CliToRename.md',
          'CliRenamed.md',
          '--expected-version',
          created.currentVersion.token,
          '--json',
        ],
      });
      expect(renameCliRes.exitCode).toBe(0);
      const renamed = JSON.parse(renameCliRes.output);
      expect(renamed.operation).toBe('rename');
      expect(renamed.newPath).toBe('CliRenamed.md');

      // 3. Delete via CLI
      const deleteCliRes = await runCli({
        url: cliGateway.url,
        token: 'cli-struct-token',
        args: [
          'delete',
          'CliRenamed.md',
          '--expected-version',
          renamed.currentVersion.token,
          '--json',
        ],
      });
      expect(deleteCliRes.exitCode).toBe(0);
      const deleted = JSON.parse(deleteCliRes.output);
      expect(deleted.operation).toBe('delete');
      expect(deleted.path).toBe('CliRenamed.md');
    } finally {
      await cliGateway.stop();
    }
  });
});

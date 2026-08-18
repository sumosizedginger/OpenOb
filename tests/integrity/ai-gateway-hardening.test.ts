import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  AIManager,
  cleanupLegacyBrowserSecrets,
  extractCitations,
  formatContextPrompt,
  isLoopbackHostname,
  isReservedOpenObPath,
  parseProposedEditFromResponse,
  redactSecrets,
  retrieveContext,
  ServerSecretStore,
  StandardSecretStore,
  validateLocalEndpointUrl,
} from '@okw/ai';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { GatewayWorkspaceBackend, OpenObGatewayClient, OpenObWorkspace } from '@okw/workspace';
import { createGatewayServer } from '../../apps/gateway/src/server.js';
import { VaultPath } from '@okw/core';

describe('Phase 3G: AI/BYOK Gateway Hardening + Workspace-Scoped Retrieval', () => {
  describe('1. ServerSecretStore & Precedence', () => {
    it('prefers runtime memory override over environment variable fallback', async () => {
      const mockEnv = {
        OPENOB_AI_OPENAI_KEY: 'sk-env-default-key-1234567890',
        OPENOB_AI_ANTHROPIC_KEY: 'sk-ant-env-anthropic-key-abcdef',
      };
      const store = new ServerSecretStore(mockEnv);

      // 1. Initial state reads from env var
      expect(await store.hasSecret('openai')).toBe(true);
      expect(await store.getSecret('openai')).toBe('sk-env-default-key-1234567890');
      expect(await store.getMaskedSecret('openai')).toBe('sk-••••••••7890');

      // 2. Set runtime memory override
      await store.setSecret('openai', 'sk-runtime-override-key-9999');
      expect(await store.getSecret('openai')).toBe('sk-runtime-override-key-9999');
      expect(await store.getMaskedSecret('openai')).toBe('sk-••••••••9999');

      // 3. Clear memory override -> falls back to env var
      await store.clearSecret('openai');
      expect(await store.getSecret('openai')).toBe('sk-env-default-key-1234567890');

      // 4. Provider without env var
      expect(await store.hasSecret('gemini')).toBe(false);
      expect(await store.getSecret('gemini')).toBeNull();
      expect(await store.getMaskedSecret('gemini')).toBeNull();
    });

    it('masks secrets of various lengths correctly', async () => {
      const store = new ServerSecretStore({});
      await store.setSecret('short', '1234567');
      expect(await store.getMaskedSecret('short')).toBe('••••••••');

      await store.setSecret('standard', 'sk-ant-api03-abcdef1234567890');
      expect(await store.getMaskedSecret('standard')).toBe('sk-••••••••7890');
    });

    it('collects all known secrets for redaction without exposing them', async () => {
      const mockEnv = {
        OPENOB_AI_OPENAI_KEY: 'sk-openai-secret-key-1111',
      };
      const store = new ServerSecretStore(mockEnv);
      await store.setSecret('anthropic', 'sk-ant-anthropic-secret-2222');

      const known = store.getAllKnownSecrets();
      expect(known).toContain('sk-openai-secret-key-1111');
      expect(known).toContain('sk-ant-anthropic-secret-2222');
    });
  });

  describe('2. Secret Redaction & Non-Leakage (Law 17)', () => {
    it('redacts explicit known secrets and regex patterns from text and error messages', () => {
      const known = ['super_secret_token_12345'];
      const rawError =
        'Error connecting to https://api.openai.com with key sk-proj-1234567890abcdef12345678 and Bearer my_jwt_token_9999999999 and super_secret_token_12345';

      const sanitized = redactSecrets(rawError, known);
      expect(sanitized).not.toContain('super_secret_token_12345');
      expect(sanitized).not.toContain('sk-proj-1234567890abcdef12345678');
      expect(sanitized).not.toContain('my_jwt_token_9999999999');
      expect(sanitized).toContain('[REDACTED_API_KEY]');
      expect(sanitized).toContain('[REDACTED_TOKEN]');
    });

    it('cleans legacy okw_sec_* keys from browser sessionStorage', () => {
      // Mock global sessionStorage
      const mockStorage: Record<string, string> = {
        okw_sec_openai: 'sk-legacy-key-1',
        okw_sec_anthropic: 'sk-legacy-key-2',
        okw_theme: 'dark',
      };

      (globalThis as any).sessionStorage = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
        get length() {
          return Object.keys(mockStorage).length;
        },
        key: (i: number) => Object.keys(mockStorage)[i] ?? null,
      };

      cleanupLegacyBrowserSecrets();

      expect(mockStorage['okw_sec_openai']).toBeUndefined();
      expect(mockStorage['okw_sec_anthropic']).toBeUndefined();
      expect(mockStorage['okw_theme']).toBe('dark');
    });
  });

  describe('3. Local Endpoint SSRF Boundary', () => {
    it('allows valid local loopback URLs (localhost, 127.0.0.1, ::1)', () => {
      expect(validateLocalEndpointUrl('http://localhost:11434/v1')).toBe(
        'http://localhost:11434/v1'
      );
      expect(validateLocalEndpointUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
      expect(validateLocalEndpointUrl('http://[::1]:8080/v1')).toBe('http://[::1]:8080/v1');
      expect(isLoopbackHostname('localhost')).toBe(true);
      expect(isLoopbackHostname('127.0.0.1')).toBe(true);
      expect(isLoopbackHostname('::1')).toBe(true);
    });

    it('rejects cloud metadata IPs, LAN IPs, and public internet targets', () => {
      // Cloud metadata endpoints
      expect(() => validateLocalEndpointUrl('http://169.254.169.254/latest/meta-data')).toThrow(
        /SSRF Security Violation/
      );
      expect(() =>
        validateLocalEndpointUrl('http://metadata.google.internal/computeMetadata/v1')
      ).toThrow(/SSRF Security Violation/);

      // LAN & Public endpoints
      expect(() => validateLocalEndpointUrl('http://192.168.1.100:11434/v1')).toThrow(
        /SSRF Security Violation/
      );
      expect(() => validateLocalEndpointUrl('http://api.openai.com/v1')).toThrow(
        /SSRF Security Violation/
      );

      // Non-HTTP schemes
      expect(() => validateLocalEndpointUrl('file:///etc/passwd')).toThrow(/Invalid protocol/);
      expect(() => validateLocalEndpointUrl('ftp://localhost:21')).toThrow(/Invalid protocol/);
    });
  });

  describe('4. Workspace-Scoped Retrieval & Namespace Isolation', () => {
    let storage: MemoryVaultStorage;
    let index: MemoryDocumentIndex;
    let parser: DefaultDocumentParser;

    beforeEach(async () => {
      storage = new MemoryVaultStorage();
      index = new MemoryDocumentIndex();
      parser = new DefaultDocumentParser();

      // Seed notes
      const notes: Record<string, string> = {
        'Research/Quantum.md':
          '# Quantum Computing\n\nQuantum algorithms leverage superposition and entanglement.',
        'Research/Neural.md':
          '# Neural Networks\n\nDeep learning models approximate complex nonlinear functions.',
        'Secret.md': '# Secret Info\n\nTop secret vault content.',
        '.openob/config.json': '{"token": "admin-secret"}',
      };

      for (const [p, content] of Object.entries(notes)) {
        await storage.write(p as VaultPath, null, content);
        if (!p.startsWith('.openob')) {
          const parsed = await parser.parse(p as VaultPath, content, 'hash1');
          await index.upsert(parsed);
        }
      }
    });

    it('strictly isolates and excludes reserved .openob namespace from retrieval', async () => {
      expect(isReservedOpenObPath('.openob/config.json')).toBe(true);
      expect(isReservedOpenObPath('.OpenOb/secrets.json')).toBe(true);
      expect(isReservedOpenObPath('notes/.openob/hidden.md')).toBe(false);

      const retrieved = await retrieveContext(storage, index, 'secret', {
        type: 'current_note',
        notePath: '.openob/config.json' as VaultPath,
      });

      expect(retrieved.chunks.length).toBe(0);
    });

    it('enforces hard scope boundaries without silent scope widening', async () => {
      // Query folder that has no matches for the term
      const retrieved = await retrieveContext(storage, index, 'superposition', {
        type: 'folder',
        folderPrefix: 'NonExistentFolder',
      });

      // Must remain empty, must NOT widen to whole vault!
      expect(retrieved.chunks.length).toBe(0);
    });

    it('retrieves accurate current note chunks', async () => {
      const retrieved = await retrieveContext(storage, index, 'superposition', {
        type: 'current_note',
        notePath: 'Research/Quantum.md' as VaultPath,
      });

      expect(retrieved.chunks.length).toBe(1);
      expect(retrieved.chunks[0].notePath).toBe('Research/Quantum.md');
      expect(retrieved.chunks[0].content).toContain('Quantum Computing');
    });
  });

  describe('5. Grounded Citations (Law 19 / G3G-1)', () => {
    it('includes structured citations ONLY for notes actually in retrieved context', () => {
      const retrievedSources = [
        { path: 'Research/Quantum.md' as VaultPath, title: 'Quantum Computing' },
      ];

      const modelResponse =
        'As discussed in [[Quantum Computing]], quantum superposition enables speedups. Also see hallucinated [[FakeNote]] and [Source: Research/Quantum.md].';

      const citations = extractCitations(modelResponse, retrievedSources);

      // Quantum Computing should be included
      expect(citations.some((c) => c.notePath === 'Research/Quantum.md')).toBe(true);
      // FakeNote MUST NOT be included because it was not in retrieved context
      expect(citations.some((c) => c.noteTitle === 'FakeNote')).toBe(false);
    });

    it('strictly grounds citation line ranges to retrieved chunk intervals (G3G-1 Test Matrix)', () => {
      const singleChunkSources = [
        {
          path: 'A.md' as VaultPath,
          title: 'Note A',
          lineStart: 10,
          lineEnd: 20,
        },
      ];

      // 1. In-range claim: 12-15 -> preserved exactly [12, 15]
      const c1 = extractCitations('See [Source: A.md (Lines 12-15)]', singleChunkSources);
      expect(c1).toHaveLength(1);
      expect(c1[0].notePath).toBe('A.md');
      expect(c1[0].lineStart).toBe(12);
      expect(c1[0].lineEnd).toBe(15);

      // 2. Left partial overlap: 1-12 -> clamped to [10, 12]
      const c2 = extractCitations('See [Source: A.md (Lines 1-12)]', singleChunkSources);
      expect(c2).toHaveLength(1);
      expect(c2[0].lineStart).toBe(10);
      expect(c2[0].lineEnd).toBe(12);

      // 3. Right partial overlap: 18-30 -> clamped to [18, 20]
      const c3 = extractCitations('See [Source: A.md (Lines 18-30)]', singleChunkSources);
      expect(c3).toHaveLength(1);
      expect(c3[0].lineStart).toBe(18);
      expect(c3[0].lineEnd).toBe(20);

      // 4. Fully outside right: 99999-100000 -> path only, NO line range
      const c4 = extractCitations('See [Source: A.md (Lines 99999-100000)]', singleChunkSources);
      expect(c4).toHaveLength(1);
      expect(c4[0].notePath).toBe('A.md');
      expect(c4[0].lineStart).toBeUndefined();
      expect(c4[0].lineEnd).toBeUndefined();

      // 5. Fully outside left: 1-5 -> path only, NO line range
      const c5 = extractCitations('See [Source: A.md (Lines 1-5)]', singleChunkSources);
      expect(c5).toHaveLength(1);
      expect(c5[0].lineStart).toBeUndefined();
      expect(c5[0].lineEnd).toBeUndefined();

      // 6. Reversed range: 20-10 -> path only / rejected range
      const c6 = extractCitations('See [Source: A.md (Lines 20-10)]', singleChunkSources);
      expect(c6).toHaveLength(1);
      expect(c6[0].lineStart).toBeUndefined();
      expect(c6[0].lineEnd).toBeUndefined();

      // 7. No line range: path only
      const c7 = extractCitations('See [Source: A.md]', singleChunkSources);
      expect(c7).toHaveLength(1);
      expect(c7[0].lineStart).toBeUndefined();
      expect(c7[0].lineEnd).toBeUndefined();

      // 8. Hallucinated path B.md -> no structured citation
      const c8 = extractCitations('See [Source: B.md (Lines 12-15)]', singleChunkSources);
      expect(c8).toHaveLength(0);
    });

    it('handles multiple discontiguous chunks for the same note truthfully', () => {
      const multiChunkSources = [
        {
          path: 'A.md' as VaultPath,
          title: 'Note A',
          lineStart: 10,
          lineEnd: 20,
        },
        {
          path: 'A.md' as VaultPath,
          title: 'Note A',
          lineStart: 40,
          lineEnd: 50,
        },
      ];

      // Claim in chunk 1 -> [12, 15]
      const c1 = extractCitations('See [Source: A.md (Lines 12-15)]', multiChunkSources);
      expect(c1[0].lineStart).toBe(12);
      expect(c1[0].lineEnd).toBe(15);

      // Claim in chunk 2 -> [42, 45]
      const c2 = extractCitations('See [Source: A.md (Lines 42-45)]', multiChunkSources);
      expect(c2[0].lineStart).toBe(42);
      expect(c2[0].lineEnd).toBe(45);

      // Claim spanning both chunks 18-42 -> MUST NOT claim unretrieved lines 21-39 -> path only
      const c3 = extractCitations('See [Source: A.md (Lines 18-42)]', multiChunkSources);
      expect(c3[0].lineStart).toBeUndefined();
      expect(c3[0].lineEnd).toBeUndefined();

      // Claim in gap between chunks 25-30 -> path only
      const c4 = extractCitations('See [Source: A.md (Lines 25-30)]', multiChunkSources);
      expect(c4[0].lineStart).toBeUndefined();
      expect(c4[0].lineEnd).toBeUndefined();
    });
  });

  describe('6. Version-Aware ProposedEdits & OCC Concurrency', () => {
    it('parses proposed edit and binds expectedVersion correctly', () => {
      const response =
        'Here is the proposed update:\n```proposal\n# Quantum Computing\n\nUpdated with latest quantum supremacy findings.\n```';

      const proposal = parseProposedEditFromResponse(
        response,
        'Research/Quantum.md' as VaultPath,
        '# Quantum Computing\n\nOld content',
        { token: 'v1_token_123', hash: 'h1', modifiedAt: 1000, size: 50 }
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.path).toBe('Research/Quantum.md');
      expect(proposal?.proposedContent).toContain('Updated with latest');
      expect(proposal?.expectedVersion?.token).toBe('v1_token_123');
    });
  });

  describe('7. Gateway AI Endpoints & Capability Enforcement', () => {
    let server: http.Server;
    let gatewayUrl: string;
    let workspace: OpenObWorkspace;
    let storage: MemoryVaultStorage;
    let index: MemoryDocumentIndex;
    let secretStore: ServerSecretStore;

    beforeEach(async () => {
      storage = new MemoryVaultStorage();
      index = new MemoryDocumentIndex();
      const parser = new DefaultDocumentParser();

      await storage.write('NoteA.md' as VaultPath, null, '# Note A\nContent of note A.');
      const parsed = await parser.parse(
        'NoteA.md' as VaultPath,
        '# Note A\nContent of note A.',
        'h1'
      );
      await index.upsert(parsed);

      workspace = new OpenObWorkspace({
        storage,
        index,
        parser,
        vaultName: 'ai-test-vault',
        serverInstanceId: 'srv-1',
        readOnly: false,
      });

      secretStore = new ServerSecretStore({
        OPENOB_AI_OPENAI_KEY: 'sk-env-openai-test-key-1234',
      });

      server = createGatewayServer({
        workspace,
        token: 'secret-token',
        scopes: [
          'workspace.read',
          'workspace.search',
          'workspace.write',
          'workspace.ai.use',
          'workspace.ai.configure',
        ],
        secretStore,
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address() as AddressInfo;
      gatewayUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('GET /api/v1/ai/providers lists available providers with masked secrets', async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/ai/providers`, {
        headers: { Authorization: 'Bearer secret-token' },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(Array.isArray(data.providers)).toBe(true);
      const openai = data.providers.find((p: any) => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai.configured).toBe(true);
      expect(openai.maskedSecret).toBe('sk-••••••••1234');
      // Verify raw secret is NEVER in response!
      expect(JSON.stringify(data)).not.toContain('sk-env-openai-test-key-1234');
    });

    it('PUT and DELETE /api/v1/ai/secrets/:provider modifies memory secrets securely', async () => {
      // 1. Configure anthropic secret
      const putRes = await fetch(`${gatewayUrl}/api/v1/ai/secrets/anthropic`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secret: 'sk-ant-custom-anthropic-key-9999' }),
      });
      expect(putRes.status).toBe(200);
      const putData = await putRes.json();
      expect(putData.success).toBe(true);
      expect(putData.masked).toBe('sk-••••••••9999');

      // 2. Status endpoint returns configured
      const statusRes = await fetch(`${gatewayUrl}/api/v1/ai/secrets/anthropic/status`, {
        headers: { Authorization: 'Bearer secret-token' },
      });
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      expect(statusData.configured).toBe(true);
      expect(statusData.masked).toBe('sk-••••••••9999');

      // 3. Clear secret
      const delRes = await fetch(`${gatewayUrl}/api/v1/ai/secrets/anthropic`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret-token' },
      });
      expect(delRes.status).toBe(200);

      // Status endpoint now returns unconfigured
      const statusRes2 = await fetch(`${gatewayUrl}/api/v1/ai/secrets/anthropic/status`, {
        headers: { Authorization: 'Bearer secret-token' },
      });
      const statusData2 = await statusRes2.json();
      expect(statusData2.configured).toBe(false);
    });

    it('enforces scope requirements strictly (403 when missing workspace.ai.use / configure)', async () => {
      // Create server with read-only scopes (no AI scopes)
      const readOnlyServer = createGatewayServer({
        workspace,
        token: 'readonly-token',
        scopes: ['workspace.read', 'workspace.search'],
      });

      await new Promise<void>((resolve) => {
        readOnlyServer.listen(0, '127.0.0.1', () => resolve());
      });
      const roAddr = readOnlyServer.address() as AddressInfo;
      const roUrl = `http://127.0.0.1:${roAddr.port}`;

      try {
        // AI providers endpoint must return 403 Forbidden
        const res = await fetch(`${roUrl}/api/v1/ai/providers`, {
          headers: { Authorization: 'Bearer readonly-token' },
        });
        expect(res.status).toBe(403);

        // AI chat endpoint must return 403 Forbidden
        const chatRes = await fetch(`${roUrl}/api/v1/ai/chat`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer readonly-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'ollama',
            model: 'llama3',
            messages: [{ role: 'user', content: 'hello' }],
          }),
        });
        expect(chatRes.status).toBe(403);
      } finally {
        await new Promise<void>((resolve) => {
          readOnlyServer.close(() => resolve());
        });
      }
    });

    it('rejects proposal application with 409 Conflict when note version diverged (OCC)', async () => {
      // 1. Read note V1
      const initialRead = await workspace.readNote('NoteA.md' as VaultPath);
      const v1Token = initialRead.version.token;

      // 2. An external mutation updates note to V2
      await workspace.updateNote({
        path: 'NoteA.md',
        content: '# Note A\nUpdated externally by MCP or human to V2.',
        expectedVersion: { token: v1Token },
      });

      // 3. User attempts to apply AI proposal that was generated against V1
      const staleProposal = {
        id: 'prop-1',
        path: 'NoteA.md' as VaultPath,
        originalContent: '# Note A\nContent of note A.',
        proposedContent: '# Note A\nAI proposed update.',
        explanation: 'Add AI info',
        expectedVersion: { token: v1Token },
        createdAt: Date.now(),
      };

      // 4. Attempt update with stale version through gateway backend
      const client = new OpenObGatewayClient({
        url: gatewayUrl,
        token: 'secret-token',
      });
      const backend = new GatewayWorkspaceBackend(client);

      await expect(
        backend.updateNote({
          path: staleProposal.path,
          content: staleProposal.proposedContent,
          expectedVersion: staleProposal.expectedVersion,
        })
      ).rejects.toThrow();
    });

    it('GET /api/v1/ai/models returns 502 AI_PROVIDER_ERROR on dead local endpoint without fake fallback (G3G-2)', async () => {
      // Endpoint is dead (nothing listening on localhost:11434)
      const res = await fetch(`${gatewayUrl}/api/v1/ai/models?provider=ollama`, {
        headers: { Authorization: 'Bearer secret-token' },
      });

      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.code).toBe('AI_PROVIDER_ERROR');
      expect(typeof data.message).toBe('string');
      // Must NOT return fake successful models
      expect(data.models).toBeUndefined();
    });

    it('GET /api/v1/ai/models returns 200 with actual discovered models when local provider recovers (G3G-2)', async () => {
      // 1. Spin up a live mock Ollama / OpenAI-compatible endpoint
      const mockProviderServer = http.createServer((req, res) => {
        if (req.url === '/v1/models' || req.url === '/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              data: [
                { id: 'llama3.1:8b', name: 'Llama 3.1 8B Instruct', context_length: 131072 },
                { id: 'mistral:7b', name: 'Mistral 7B', context_length: 32768 },
              ],
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        mockProviderServer.listen(0, '127.0.0.1', () => resolve());
      });

      const mockPort = (mockProviderServer.address() as AddressInfo).port;
      const mockEndpoint = `http://127.0.0.1:${mockPort}/v1`;

      // 2. Create custom AIManager targeting the live mock endpoint
      const customAiManager = new AIManager(
        {
          activeProviderId: 'ollama',
          ollamaEndpoint: mockEndpoint,
        },
        secretStore
      );

      const mockGateway = createGatewayServer({
        workspace,
        token: 'secret-token',
        scopes: ['workspace.ai.use'],
        secretStore,
        aiManager: customAiManager,
      });

      await new Promise<void>((resolve) => {
        mockGateway.listen(0, '127.0.0.1', () => resolve());
      });

      const gwPort = (mockGateway.address() as AddressInfo).port;

      try {
        const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/ai/models?provider=ollama`, {
          headers: { Authorization: 'Bearer secret-token' },
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data.models)).toBe(true);
        expect(data.models).toHaveLength(2);
        expect(data.models[0].id).toBe('llama3.1:8b');
        expect(data.models[1].id).toBe('mistral:7b');
      } finally {
        await new Promise<void>((resolve) => mockGateway.close(() => resolve()));
        await new Promise<void>((resolve) => mockProviderServer.close(() => resolve()));
      }
    });

    it('redacts sensitive secrets in model listing error messages (G3G-2 / Law 17)', async () => {
      // Configure secret that would appear in error
      await secretStore.setSecret('openai', 'sk-super-secret-model-list-key-123456');

      // Force provider error by calling unconfigured endpoint or mock error
      const mockFailingServer = http.createServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              'Unauthorized key sk-super-secret-model-list-key-123456 and Bearer auth_jwt_9999',
          })
        );
      });

      await new Promise<void>((resolve) => {
        mockFailingServer.listen(0, '127.0.0.1', () => resolve());
      });

      const mockPort = (mockFailingServer.address() as AddressInfo).port;
      const customAiManager = new AIManager(
        {
          activeProviderId: 'ollama',
          ollamaEndpoint: `http://127.0.0.1:${mockPort}/v1`,
        },
        secretStore
      );

      const mockGateway = createGatewayServer({
        workspace,
        token: 'secret-token',
        scopes: ['workspace.ai.use'],
        secretStore,
        aiManager: customAiManager,
      });

      await new Promise<void>((resolve) => {
        mockGateway.listen(0, '127.0.0.1', () => resolve());
      });

      const gwPort = (mockGateway.address() as AddressInfo).port;

      try {
        const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/ai/models?provider=ollama`, {
          headers: { Authorization: 'Bearer secret-token' },
        });

        expect(res.status).toBe(502);
        const data = await res.json();
        expect(data.code).toBe('AI_PROVIDER_ERROR');
        // Raw secret MUST be redacted
        expect(data.message).not.toContain('sk-super-secret-model-list-key-123456');
        expect(data.message).toContain('[REDACTED_API_KEY]');
      } finally {
        await new Promise<void>((resolve) => mockGateway.close(() => resolve()));
        await new Promise<void>((resolve) => mockFailingServer.close(() => resolve()));
      }
    });
  });
});

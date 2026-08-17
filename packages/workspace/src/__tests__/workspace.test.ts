import { describe, expect, it } from 'vitest';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import { MemoryVaultStorage } from '@okw/vault';
import { handleMcpToolCall, MCP_TOOL_DEFINITIONS } from '../mcp.js';
import { OpenObWorkspace } from '../workspace.js';

describe('OpenObWorkspace Application Service Layer (@okw/workspace)', () => {
  async function createFixtureWorkspace() {
    const storage = new MemoryVaultStorage('test-vault');
    const parser = new DefaultDocumentParser();
    const index = new MemoryDocumentIndex();

    // Seed notes
    const note1Content = `---
title: Welcome Note
aliases: [Welcome Note]
tags: [getting-started, intro]
status: active
priority: 1
---
# Welcome to OpenOb

This is the main entry point. See [[Architecture]] and [[Daily/2026-08-16]].
`;

    const note2Content = `---
title: System Architecture
tags: [architecture, core]
---
# Architecture Overview

Describes [[Welcome Note]] and links to [[NonExistent]].
`;

    const note3Content = `# Daily Note 2026-08-16
Tasks:
- [x] Build workspace package
- [ ] Review architecture
`;

    const snap1 = (await storage.write('Welcome.md', null, note1Content)).snapshot;
    const snap2 = (await storage.write('Architecture.md', null, note2Content)).snapshot;
    const snap3 = (await storage.write('Daily/2026-08-16.md', null, note3Content)).snapshot;

    const p1 = await parser.parse('Welcome.md', snap1.textContent!, snap1.version.hash);
    const p2 = await parser.parse('Architecture.md', snap2.textContent!, snap2.version.hash);
    const p3 = await parser.parse('Daily/2026-08-16.md', snap3.textContent!, snap3.version.hash);

    await index.upsert(p1);
    await index.upsert(p2);
    await index.upsert(p3);

    const workspace = new OpenObWorkspace({
      storage,
      index,
      parser,
      vaultName: 'test-vault',
      readOnly: true,
    });

    return { workspace, storage, index, parser };
  }

  it('1. getWorkspaceInfo returns truthful metrics, readOnly flag, and apiVersion', async () => {
    const { workspace } = await createFixtureWorkspace();
    const info = await workspace.getWorkspaceInfo();

    expect(info.name).toBe('test-vault');
    expect(info.apiVersion).toBe('v1');
    expect(info.readOnly).toBe(true);
    expect(info.noteCount).toBe(3);
    expect(info.capabilities).toContain('workspace.read');
    expect(info.capabilities).toContain('workspace.search');
  });

  it('2. listEntries retrieves root and nested directory contents', async () => {
    const { workspace } = await createFixtureWorkspace();

    const rootEntries = await workspace.listEntries('');
    expect(rootEntries.length).toBeGreaterThanOrEqual(3);
    expect(rootEntries.some((e) => e.name === 'Welcome.md')).toBe(true);

    const dailyEntries = await workspace.listEntries('Daily');
    expect(dailyEntries.length).toBe(1);
    expect(dailyEntries[0].name).toBe('2026-08-16.md');
  });

  it('3. readNote returns full parsed metadata, properties, headings, and links', async () => {
    const { workspace } = await createFixtureWorkspace();

    const note = await workspace.readNote('Welcome.md');
    expect(note.path).toBe('Welcome.md');
    expect(note.title).toBe('Welcome Note');
    expect(note.properties).toEqual({
      title: 'Welcome Note',
      aliases: ['Welcome Note'],
      tags: ['getting-started', 'intro'],
      status: 'active',
      priority: 1,
    });
    expect(note.tags).toEqual(['getting-started', 'intro']);
    expect(note.headings).toHaveLength(1);
    expect(note.headings[0].text).toBe('Welcome to OpenOb');
    expect(note.links).toHaveLength(2);
    expect(note.links.map((l) => l.target)).toEqual(['Architecture', 'Daily/2026-08-16']);
    expect(note.version.token).toBeDefined();
    expect(note.textContent).toContain('This is the main entry point');
  });

  it('4. getNoteMetadata returns summary without full body overhead', async () => {
    const { workspace } = await createFixtureWorkspace();

    const meta = await workspace.getNoteMetadata('Welcome.md');
    expect(meta.path).toBe('Welcome.md');
    expect(meta.title).toBe('Welcome Note');
    expect(meta.hasFrontmatter).toBe(true);
    expect(meta.tags).toContain('getting-started');
    expect(meta.wordCount).toBeGreaterThan(0);
    expect(meta.lineCount).toBeGreaterThan(0);
  });

  it('5. search queries index with tag and path filtering', async () => {
    const { workspace } = await createFixtureWorkspace();

    const allRes = await workspace.search({ query: 'OpenOb' });
    expect(allRes.total).toBe(1);
    expect(allRes.matches[0].path).toBe('Welcome.md');

    const tagRes = await workspace.search({ query: 'Architecture', tags: ['architecture'] });
    expect(tagRes.total).toBe(1);
    expect(tagRes.matches[0].path).toBe('Architecture.md');

    const prefixRes = await workspace.search({ query: 'Build', pathPrefix: 'Daily' });
    expect(prefixRes.total).toBe(1);
    expect(prefixRes.matches[0].path).toBe('Daily/2026-08-16.md');
  });

  it('6. getBacklinks returns incoming backlinks truthfully', async () => {
    const { workspace } = await createFixtureWorkspace();

    // Architecture.md links to Welcome Note
    const backlinks = await workspace.getBacklinks('Welcome.md');
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourcePath).toBe('Architecture.md');
  });

  it('7. getOutgoingLinks returns resolved and unresolved targets', async () => {
    const { workspace } = await createFixtureWorkspace();

    const links = await workspace.getOutgoingLinks('Architecture.md');
    expect(links).toHaveLength(2);

    const welcomeLink = links.find((l) => l.rawTarget === 'Welcome Note');
    expect(welcomeLink).toBeDefined();
    expect(welcomeLink?.resolved).toBe(true);
    expect(welcomeLink?.targetPath).toBe('Welcome.md');

    const nonExistentLink = links.find((l) => l.rawTarget === 'NonExistent');
    expect(nonExistentLink).toBeDefined();
    expect(nonExistentLink?.resolved).toBe(false);
  });

  it('8. getProperties returns frontmatter properties accurately', async () => {
    const { workspace } = await createFixtureWorkspace();

    const props = await workspace.getProperties('Welcome.md');
    expect(props.path).toBe('Welcome.md');
    expect(props.properties.status).toBe('active');
    expect(props.properties.priority).toBe(1);
  });

  it('9. getGraphNeighbors extracts local 1-hop graph structure', async () => {
    const { workspace } = await createFixtureWorkspace();

    const neighbors = await workspace.getGraphNeighbors('Welcome.md');
    expect(neighbors.path).toBe('Welcome.md');
    expect(neighbors.title).toBe('Welcome Note');
    expect(neighbors.incoming).toHaveLength(1);
    expect(neighbors.outgoing).toHaveLength(2);
    expect(neighbors.neighbors.some((n) => n.path === 'Architecture.md')).toBe(true);
  });

  it('10. Security: path traversal attempts throw INVALID_PATH / SecurityError', async () => {
    const { workspace } = await createFixtureWorkspace();

    await expect(workspace.readNote('../secret.md')).rejects.toThrow();
    await expect(workspace.readNote('foo/../../bar.md')).rejects.toThrow();
    await expect(workspace.readNote('C:\\Windows\\system32')).rejects.toThrow();
    await expect(workspace.readNote('/etc/passwd')).rejects.toThrow();
    await expect(workspace.readNote('note\0.md')).rejects.toThrow();
  });

  it('11. Truthful NOT_FOUND error on non-existent note', async () => {
    const { workspace } = await createFixtureWorkspace();

    await expect(workspace.readNote('MissingNote.md')).rejects.toThrow();
    await expect(workspace.getBacklinks('MissingNote.md')).rejects.toThrow();
  });

  it('12. Read operations do NOT mutate storage or index', async () => {
    const { workspace, storage, index } = await createFixtureWorkspace();

    const docsBefore = await index.getAll();
    const filesBefore = await storage.list('');

    await workspace.getWorkspaceInfo();
    await workspace.readNote('Welcome.md');
    await workspace.search({ query: 'Welcome' });
    await workspace.getBacklinks('Welcome.md');
    await workspace.getProperties('Welcome.md');
    await workspace.getGraphNeighbors('Welcome.md');

    const docsAfter = await index.getAll();
    const filesAfter = await storage.list('');

    expect(docsAfter.length).toBe(docsBefore.length);
    expect(filesAfter.length).toBe(filesBefore.length);
  });

  it('13. MCP tool declarations and dispatcher execute properly', async () => {
    const { workspace } = await createFixtureWorkspace();

    expect(MCP_TOOL_DEFINITIONS).toHaveLength(11);

    const infoRes = await handleMcpToolCall(workspace, 'openob_workspace_info');
    expect(infoRes.isError).toBeFalsy();
    const parsedInfo = JSON.parse(infoRes.content[0].text);
    expect(parsedInfo.name).toBe('test-vault');

    const readRes = await handleMcpToolCall(workspace, 'openob_read_note', {
      path: 'Welcome.md',
    });
    expect(readRes.isError).toBeFalsy();
    const parsedNote = JSON.parse(readRes.content[0].text);
    expect(parsedNote.title).toBe('Welcome Note');

    const searchRes = await handleMcpToolCall(workspace, 'openob_search', {
      query: 'OpenOb',
    });
    expect(searchRes.isError).toBeFalsy();
    const parsedSearch = JSON.parse(searchRes.content[0].text);
    expect(parsedSearch.total).toBe(1);

    const errRes = await handleMcpToolCall(workspace, 'openob_read_note', {
      path: '../evil.md',
    });
    expect(errRes.isError).toBe(true);
  });

  it('14. Boundary Hardening: internal subsystems (storage, index, safeWriter, coordinator) are private', async () => {
    const { workspace } = await createFixtureWorkspace();

    // Verify public properties
    expect(workspace.vaultName).toBe('test-vault');
    expect(workspace.readOnly).toBe(true);

    // Verify internal mutation machinery is not part of public API
    const publicKeys = Object.keys(workspace);
    expect(publicKeys).toContain('vaultName');
    expect(publicKeys).toContain('readOnly');

    // Type-level assertion: ensure OpenObWorkspace type only has read-only methods and metadata
    type PublicWorkspaceKeys = keyof OpenObWorkspace;
    // Compile-time check: 'storage' | 'index' | 'safeWriter' | 'coordinator' must NOT be in PublicWorkspaceKeys
    type IsExposed<K extends string> = K extends PublicWorkspaceKeys ? true : false;
    type StorageExposed = IsExposed<'storage'>;
    type IndexExposed = IsExposed<'index'>;
    type SafeWriterExposed = IsExposed<'safeWriter'>;
    type CoordinatorExposed = IsExposed<'coordinator'>;

    const _storageCheck: StorageExposed = false;
    const _indexCheck: IndexExposed = false;
    const _safeWriterCheck: SafeWriterExposed = false;
    const _coordinatorCheck: CoordinatorExposed = false;
    expect(_storageCheck).toBe(false);
    expect(_indexCheck).toBe(false);
    expect(_safeWriterCheck).toBe(false);
    expect(_coordinatorCheck).toBe(false);
  });

  it('15. P3A-4: Leading slash paths normalize safely to vault-relative paths', async () => {
    const { workspace } = await createFixtureWorkspace();

    // /Welcome.md normalizes to Welcome.md and reads correctly
    const note = await workspace.readNote('/Welcome.md');
    expect(note.path).toBe('Welcome.md');
    expect(note.title).toBe('Welcome Note');
  });
});

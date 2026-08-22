import { describe, expect, it, vi } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
import { DefaultDocumentParser } from '@okw/markdown';
import {
  OpenObWorkspace,
  LocalWorkspaceBackend,
  createWorkspacePluginHostServices,
} from '@okw/workspace';
import {
  PluginHost,
  templatesManifest,
  TemplatesPlugin,
  characterBibleManifest,
  CharacterBiblePlugin,
  manuscriptToolsManifest,
  ManuscriptToolsPlugin,
  wordCountManifest,
  WordCountPlugin,
  dailyNotesManifest,
  DailyNotesPlugin,
} from '@okw/plugin';

async function createTestHost(options?: {
  initialNotes?: Record<string, string>;
  activeNotePath?: string | null;
  onOpenNote?: (p: string) => Promise<void>;
  onShowNotice?: (m: string) => void;
}) {
  const storage = new MemoryVaultStorage();
  const index = new MemoryDocumentIndex();
  const parser = new DefaultDocumentParser();

  const workspace = new OpenObWorkspace({
    storage,
    index,
    parser,
    readOnly: false,
  });
  const backend = new LocalWorkspaceBackend(workspace);

  if (options?.initialNotes) {
    for (const [p, content] of Object.entries(options.initialNotes)) {
      await workspace.createNote({ path: p, content });
    }
  }

  const services = createWorkspacePluginHostServices(backend, undefined, {
    getActiveNotePath: () => (options?.activeNotePath ?? null) as any,
    openNote: options?.onOpenNote ? async (p) => options.onOpenNote!(p) : async () => {},
    showNotice: options?.onShowNotice ?? (() => {}),
  });

  const host = new PluginHost({ services });
  return { host, workspace, backend, storage, index };
}

describe('Phase 10 Exit Gate: First-Party Plugin Pack & Public API Dogfooding (Constitution Law 20, D-020)', () => {
  it('TemplatesPlugin: creates notes from template and interpolates dynamic variables', async () => {
    let openedNote: string | null = null;
    const noticeSpy = vi.fn();

    const { host, backend } = await createTestHost({
      initialNotes: {
        'Templates/Meeting.md': `---\ntitle: {{title}}\ndate: {{date}}\ntags: [custom-template]\n---\n# {{title}}\nCreated at {{time}}.\n`,
      },
      onOpenNote: async (p) => {
        openedNote = p;
      },
      onShowNotice: noticeSpy,
    });

    host.registerPlugin(templatesManifest, () => new TemplatesPlugin());
    await host.enablePlugin(templatesManifest.id);

    // 2. Execute create from template
    const res = await host.executeCommand('templates.createFromTemplate');
    expect(res.success).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(openedNote).toBe(`Notes/Meeting-${today}.md`);

    const createdDoc = await backend.readNote(`Notes/Meeting-${today}.md`);
    expect(createdDoc.textContent).toContain(`title: Meeting-${today}`);
    expect(createdDoc.textContent).toContain(`date: ${today}`);
    expect(createdDoc.textContent).not.toContain('{{title}}');
    expect(createdDoc.textContent).not.toContain('{{date}}');
  });

  it('CharacterBiblePlugin: creates structured character profile and tallies roster', async () => {
    let openedPath: string | null = null;
    const noticeSpy = vi.fn();

    const { host, backend } = await createTestHost({
      onOpenNote: async (p) => {
        openedPath = p;
      },
      onShowNotice: noticeSpy,
    });

    host.registerPlugin(characterBibleManifest, () => new CharacterBiblePlugin());
    await host.enablePlugin(characterBibleManifest.id);

    // 1. Create Character Profile
    const createRes = await host.executeCommand('characterBible.create');
    expect(createRes.success).toBe(true);
    expect(openedPath).toBe('Characters/NewCharacter.md');

    const charDoc = await backend.readNote('Characters/NewCharacter.md');
    expect(charDoc.textContent).toContain('type: character');
    expect(charDoc.textContent).toContain('role: protagonist');
    expect(charDoc.textContent).toContain('# NewCharacter');

    // 2. List Roster
    const listRes = await host.executeCommand('characterBible.list');
    expect(listRes.success).toBe(true);
    expect(noticeSpy).toHaveBeenCalledWith(expect.stringContaining('1 characters registered'));
  });

  it('ManuscriptToolsPlugin: scans manuscript chapters, tallies words, and calculates target progress', async () => {
    const noticeSpy = vi.fn();

    const { host } = await createTestHost({
      initialNotes: {
        'Manuscript/Chapter_01.md': '# Chapter 1\n\n' + 'word '.repeat(1000),
        'Manuscript/Chapter_02.md': '# Chapter 2\n\n' + 'word '.repeat(2000),
        'Manuscript/Chapter_03.md': '# Chapter 3\n\n' + 'word '.repeat(2000),
      },
      onShowNotice: noticeSpy,
    });

    host.registerPlugin(manuscriptToolsManifest, () => new ManuscriptToolsPlugin());
    await host.enablePlugin(manuscriptToolsManifest.id);

    // 2. Calculate Progress
    const reportRes = await host.executeCommand('manuscriptTools.progressReport');
    expect(reportRes.success).toBe(true);

    // 5009 words across 3 chapters (10% of 50k goal, avg ~1670 w/ch)
    expect(noticeSpy).toHaveBeenCalledWith(
      expect.stringContaining('5,009 / 50,000 words (10%) across 3 chapters')
    );
  });

  it('Zero Private Imports: All first-party plugins operate concurrently via standard host lifecycle', async () => {
    const { host } = await createTestHost();

    // Register all 5 first-party plugins
    host.registerPlugin(wordCountManifest, () => new WordCountPlugin());
    host.registerPlugin(dailyNotesManifest, () => new DailyNotesPlugin());
    host.registerPlugin(templatesManifest, () => new TemplatesPlugin());
    host.registerPlugin(characterBibleManifest, () => new CharacterBiblePlugin());
    host.registerPlugin(manuscriptToolsManifest, () => new ManuscriptToolsPlugin());

    for (const p of host.getPlugins()) {
      const enabled = await host.enablePlugin(p.manifest.id);
      expect(enabled).toBe(true);
      expect(p.status).toBe('enabled');
    }

    const allCommands = host.getAllCommands();
    expect(allCommands.length).toBeGreaterThanOrEqual(7);
  });
});

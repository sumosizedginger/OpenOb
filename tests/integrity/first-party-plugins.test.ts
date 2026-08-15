import { describe, expect, it, vi } from 'vitest';
import { MemoryVaultStorage } from '@okw/vault';
import { MemoryDocumentIndex } from '@okw/index';
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

describe('Phase 10 Exit Gate: First-Party Plugin Pack & Public API Dogfooding (Constitution Law 20, D-020)', () => {
  it('TemplatesPlugin: creates notes from template and interpolates dynamic variables', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    // 1. Create a custom template in Templates/
    const customTemplate = `---\ntitle: {{title}}\ndate: {{date}}\ntags: [custom-template]\n---\n# {{title}}\nCreated at {{time}}.\n`;
    await storage.write('Templates/Meeting.md', null, customTemplate);

    let openedNote: string | null = null;
    const noticeSpy = vi.fn();

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async (p) => {
        openedNote = p;
      },
      showNotice: noticeSpy,
    });

    host.registerPlugin(templatesManifest, () => new TemplatesPlugin());
    await host.enablePlugin(templatesManifest.id);

    // 2. Execute create from template
    const res = await host.executeCommand('templates.createFromTemplate');
    expect(res.success).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(openedNote).toBe(`Notes/Meeting-${today}.md`);

    const createdDoc = await storage.read(`Notes/Meeting-${today}.md`);
    const docText = new TextDecoder().decode(createdDoc.content);

    expect(docText).toContain(`title: Meeting-${today}`);
    expect(docText).toContain(`date: ${today}`);
    expect(docText).not.toContain('{{title}}');
    expect(docText).not.toContain('{{date}}');
  });

  it('CharacterBiblePlugin: creates structured character profile and tallies roster', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    let openedPath: string | null = null;
    const noticeSpy = vi.fn();

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async (p) => {
        openedPath = p;
      },
      showNotice: noticeSpy,
    });

    host.registerPlugin(characterBibleManifest, () => new CharacterBiblePlugin());
    await host.enablePlugin(characterBibleManifest.id);

    // 1. Create Character Profile
    const createRes = await host.executeCommand('characterBible.create');
    expect(createRes.success).toBe(true);
    expect(openedPath).toBe('Characters/NewCharacter.md');

    const charDoc = await storage.read('Characters/NewCharacter.md');
    const charText = new TextDecoder().decode(charDoc.content);
    expect(charText).toContain('type: character');
    expect(charText).toContain('role: protagonist');
    expect(charText).toContain('# NewCharacter');

    // 2. List Roster
    const listRes = await host.executeCommand('characterBible.list');
    expect(listRes.success).toBe(true);
    expect(noticeSpy).toHaveBeenCalledWith(expect.stringContaining('1 characters registered'));
  });

  it('ManuscriptToolsPlugin: scans manuscript chapters, tallies words, and calculates target progress', async () => {
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    // 1. Seed 3 chapter notes in Manuscript/
    await storage.write('Manuscript/Chapter_01.md', null, '# Chapter 1\n\n' + 'word '.repeat(1000));
    await storage.write('Manuscript/Chapter_02.md', null, '# Chapter 2\n\n' + 'word '.repeat(2000));
    await storage.write('Manuscript/Chapter_03.md', null, '# Chapter 3\n\n' + 'word '.repeat(2000));

    const noticeSpy = vi.fn();

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: noticeSpy,
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
    const storage = new MemoryVaultStorage();
    const index = new MemoryDocumentIndex();

    const host = new PluginHost({
      storage,
      index,
      activeNotePath: null,
      openNote: async () => {},
      showNotice: () => {},
    });

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

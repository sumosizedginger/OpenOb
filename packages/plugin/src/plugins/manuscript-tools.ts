import { Plugin, PluginAPI, PluginManifest } from '../types.js';

export const manuscriptToolsManifest: PluginManifest = {
  id: 'okw.manuscript-tools',
  name: 'Manuscript Tools & Word Tracker',
  version: '1.0.0',
  apiVersion: '1.x',
  description: 'Novel and manuscript progress tracker with chapter statistics and target goals.',
  permissions: ['vault.read'],
  contributes: {
    commands: [
      { id: 'manuscriptTools.progressReport', name: 'Manuscript: Calculate Progress Report' },
    ],
  },
};

export class ManuscriptToolsPlugin implements Plugin {
  onload(api: PluginAPI): void {
    api.commands.registerCommand({
      id: 'manuscriptTools.progressReport',
      name: 'Manuscript: Calculate Progress Report',
      callback: async () => {
        let chapterPaths = await api.vault.list('Manuscript');
        if (chapterPaths.length === 0) {
          chapterPaths = await api.vault.list('Chapters');
        }

        if (chapterPaths.length === 0) {
          api.ui.showNotice('Manuscript Tools: No chapters found in Manuscript/ or Chapters/ folders.');
          return;
        }

        let totalWords = 0;
        for (const path of chapterPaths) {
          const content = await api.vault.read(path);
          const words = content.trim() ? content.trim().split(/\s+/).length : 0;
          totalWords += words;
        }

        const chapterCount = chapterPaths.length;
        const avgWords = Math.round(totalWords / chapterCount);
        const targetGoal = 50000;
        const percent = Math.min(100, Math.round((totalWords / targetGoal) * 100));

        api.ui.showNotice(
          `Manuscript Progress: ${totalWords.toLocaleString()} / ${targetGoal.toLocaleString()} words (${percent}%) across ${chapterCount} chapters (avg ${avgWords} w/ch).`
        );
      },
    });
  }

  onunload(): void {}
}

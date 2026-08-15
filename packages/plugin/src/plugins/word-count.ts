import { Plugin, PluginAPI, PluginManifest } from '../types.js';

export const wordCountManifest: PluginManifest = {
  id: 'okw.word-count',
  name: 'Document Statistics & Word Count',
  version: '1.0.0',
  apiVersion: '1.x',
  description: 'Calculates word count, character count, and estimated reading time for documents.',
  permissions: ['vault.read'],
  contributes: {
    commands: [{ id: 'wordCount.compute', name: 'Word Count: Calculate Document Stats' }],
  },
};

export class WordCountPlugin implements Plugin {
  onload(api: PluginAPI): void {
    api.commands.registerCommand({
      id: 'wordCount.compute',
      name: 'Word Count: Calculate Document Stats',
      callback: async () => {
        const activePath = api.workspace.getActiveNotePath();
        if (!activePath) {
          api.ui.showNotice('No active note to count words.');
          return;
        }

        const text = await api.vault.read(activePath);
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const chars = text.length;
        const readingTimeMins = Math.ceil(words / 200);

        api.ui.showNotice(
          `Document Stats (${activePath}): ${words} words, ${chars} chars, ~${readingTimeMins} min read.`
        );
      },
    });
  }

  onunload(): void {
    // Cleanup if needed
  }
}

import { Plugin, PluginAPI, PluginManifest } from '../types.js';
import { VaultPath } from '@okw/core';

export const dailyNotesManifest: PluginManifest = {
  id: 'okw.daily-notes',
  name: 'Daily Notes & Journal',
  version: '1.0.0',
  apiVersion: '2.x',
  description: 'Quickly open or create timestamped daily journal notes.',
  permissions: ['vault.read', 'vault.write', 'workspace.modify'],
  contributes: {
    commands: [{ id: 'dailyNotes.openToday', name: 'Daily Notes: Open Today' }],
  },
};

export class DailyNotesPlugin implements Plugin {
  onload(api: PluginAPI): void {
    api.commands.registerCommand({
      id: 'dailyNotes.openToday',
      name: 'Daily Notes: Open Today',
      callback: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const dailyPath = `Daily/${today}.md` as VaultPath;

        const existingFiles = await api.vault.list('Daily');
        if (!existingFiles.includes(dailyPath)) {
          const template = `# Daily Note: ${today}\n\n## Tasks\n- [ ] \n\n## Journal\n\n`;
          try {
            await api.vault.create(dailyPath, template);
          } catch {
            // Concurrent creation winner already created note; proceed to open
          }
        }

        await api.workspace.openNote(dailyPath);
        api.ui.showNotice(`Opened daily note: ${dailyPath}`);
      },
    });
  }

  onunload(): void {
    // Cleanup if needed
  }
}

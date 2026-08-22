import { Plugin, PluginAPI, PluginManifest } from '../types.js';
import { VaultPath } from '@okw/core';

export const templatesManifest: PluginManifest = {
  id: 'okw.templates',
  name: 'Templates Engine',
  version: '1.0.0',
  apiVersion: '2.x',
  description: 'Create and insert reusable note templates with dynamic variables.',
  permissions: ['vault.read', 'vault.write', 'workspace.modify'],
  contributes: {
    commands: [
      { id: 'templates.createFromTemplate', name: 'Templates: Create Note from Template' },
      { id: 'templates.insertDefault', name: 'Templates: Insert Meeting Template' },
    ],
  },
};

export function interpolateTemplate(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, val] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    result = result.replace(regex, val);
  }
  return result;
}

export class TemplatesPlugin implements Plugin {
  onload(api: PluginAPI): void {
    api.commands.registerCommand({
      id: 'templates.createFromTemplate',
      name: 'Templates: Create Note from Template',
      callback: async () => {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 8);
        const title = `Meeting-${dateStr}`;
        const newPath = `Notes/${title}.md` as VaultPath;

        // Check if custom template exists in Templates/
        let templateContent = `---\ntitle: {{title}}\ndate: {{date}}\ntags: [meeting]\n---\n# {{title}}\n\n## Attendees\n- \n\n## Discussion\n\n## Action Items\n- [ ] `;

        const existingTemplates = await api.vault.list('Templates');
        if (existingTemplates.includes('Templates/Meeting.md' as VaultPath)) {
          const tSnap = await api.vault.read('Templates/Meeting.md' as VaultPath);
          templateContent = tSnap.content;
        }

        const interpolated = interpolateTemplate(templateContent, {
          title,
          date: dateStr,
          time: timeStr,
          datetime: `${dateStr} ${timeStr}`,
        });

        await api.vault.create(newPath, interpolated);
        await api.workspace.openNote(newPath);
        api.ui.showNotice(`Created new note from template: ${newPath}`);
      },
    });

    api.commands.registerCommand({
      id: 'templates.insertDefault',
      name: 'Templates: Insert Meeting Template',
      callback: async () => {
        const activePath = api.workspace.getActiveNotePath();
        if (!activePath) {
          api.ui.showNotice('No active note to insert template into.');
          return;
        }

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 8);
        const title = activePath.split('/').pop()?.replace(/\.md$/, '') || 'Note';

        const snippet = `\n\n## Meeting Notes ({{date}})\n**Time:** {{time}}\n\n### Summary\n\n### Action Items\n- [ ] \n`;
        const interpolated = interpolateTemplate(snippet, {
          title,
          date: dateStr,
          time: timeStr,
          datetime: `${dateStr} ${timeStr}`,
        });

        const snap = await api.vault.read(activePath);
        await api.vault.update(activePath, snap.content + interpolated, snap.version);
        api.ui.showNotice(`Inserted meeting template into ${activePath}`);
      },
    });
  }

  onunload(): void {}
}

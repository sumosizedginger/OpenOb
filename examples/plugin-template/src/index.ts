import { Plugin, PluginAPI, PluginManifest } from '@okw/plugin';

export const examplePluginManifest: PluginManifest = {
  id: 'com.example.note-stamping',
  name: 'Note Stamper',
  version: '1.0.0',
  apiVersion: '2.x',
  description: 'Appends an updated timestamp signature to active note with strict OCC.',
  permissions: ['vault.read', 'vault.write', 'workspace.modify'],
  contributes: {
    commands: [{ id: 'stamper.stampActive', name: 'Note Stamper: Stamp Active Note' }],
    views: [{ id: 'stamper.sidebar', name: 'Note Stamper Statistics' }],
  },
};

export class ExampleStamperPlugin implements Plugin {
  onload(api: PluginAPI): void {
    // 1. Register a command with OCC version binding
    api.commands.registerCommand({
      id: 'stamper.stampActive',
      name: 'Note Stamper: Stamp Active Note',
      callback: async () => {
        const activePath = api.workspace.getActiveNotePath();
        if (!activePath) {
          api.ui.showNotice('No active note selected.');
          return;
        }

        // Read snapshot (content + version token)
        const snapshot = await api.vault.read(activePath);
        const stamp = `\n\n_Last stamped: ${new Date().toISOString()}_\n`;

        // Update note strictly providing expectedVersion (OCC)
        await api.vault.update(activePath, snapshot.content + stamp, snapshot.version);
        api.ui.showNotice(`Successfully stamped ${activePath}!`);
      },
    });

    // 2. Register a view
    api.ui.registerView({
      id: 'stamper.sidebar',
      name: 'Note Stamper Statistics',
      render: (container: HTMLElement) => {
        container.innerHTML = `
          <div style="padding: 12px; font-family: sans-serif;">
            <h3>Note Stamper</h3>
            <p>Ready to stamp notes safely using OCC version control.</p>
          </div>
        `;
      },
    });
  }

  onunload(): void {
    // Clean up timers or resource handlers if any
  }
}

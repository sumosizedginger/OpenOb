import { Plugin, PluginAPI, PluginManifest } from '../types.js';
import { VaultPath } from '@okw/core';

export const characterBibleManifest: PluginManifest = {
  id: 'okw.character-bible',
  name: 'Character Bible & Worldbuilding',
  version: '1.0.0',
  apiVersion: '2.x',
  description: 'Manage character profiles, relationships, factions, and world-building notes.',
  permissions: ['vault.read', 'vault.write', 'workspace.modify', 'search.query'],
  contributes: {
    commands: [
      { id: 'characterBible.create', name: 'Character Bible: New Character Profile' },
      { id: 'characterBible.list', name: 'Character Bible: Roster Summary' },
    ],
  },
};

export class CharacterBiblePlugin implements Plugin {
  onload(api: PluginAPI): void {
    api.commands.registerCommand({
      id: 'characterBible.create',
      name: 'Character Bible: New Character Profile',
      callback: async () => {
        const charName = 'NewCharacter';
        const targetPath = `Characters/${charName}.md` as VaultPath;

        const template = `---
title: ${charName}
type: character
role: protagonist
status: active
affiliations: []
aliases: []
tags: [character, worldbuilding]
---
# ${charName}

## Overview
A brief summary of who this character is and their narrative motivation.

## Appearance & Traits
- **Age:** 
- **Height:** 
- **Distinctive Features:** 

## Relationships
- [[Ally]]: Trusted companion.
- [[Rival]]: Competitor.

## Biography & Arcs
`;

        await api.vault.create(targetPath, template);
        await api.workspace.openNote(targetPath);
        api.ui.showNotice(`Created character profile: ${targetPath}`);
      },
    });

    api.commands.registerCommand({
      id: 'characterBible.list',
      name: 'Character Bible: Roster Summary',
      callback: async () => {
        const charFiles = await api.vault.list('Characters');
        const characterCount = charFiles.length;
        api.ui.showNotice(`Character Bible: ${characterCount} characters registered in vault.`);
      },
    });
  }

  onunload(): void {}
}

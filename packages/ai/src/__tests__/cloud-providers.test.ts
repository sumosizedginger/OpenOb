import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { GeminiProvider } from '../providers/gemini.js';
import { OpenRouterProvider } from '../providers/openrouter.js';
import { AIManager } from '../ai-manager.js';
import { StandardSecretStore } from '../secrets.js';

describe('Cloud Provider Adapters (Phase 8)', () => {
  it('lists models with default designations across providers', async () => {
    const openai = new OpenAIProvider({ apiKey: 'mock-key' });
    const anthropic = new AnthropicProvider({ apiKey: 'mock-key' });
    const gemini = new GeminiProvider({ apiKey: 'mock-key' });
    const openrouter = new OpenRouterProvider({ apiKey: 'mock-key' });

    const openAiModels = await openai.listModels();
    expect(openAiModels.length).toBeGreaterThan(0);
    expect(openAiModels.some((m) => m.isDefault)).toBe(true);

    const anthropicModels = await anthropic.listModels();
    expect(anthropicModels.length).toBeGreaterThan(0);
    expect(anthropicModels.some((m) => m.id.includes('claude-3-5-sonnet'))).toBe(true);

    const geminiModels = await gemini.listModels();
    expect(geminiModels.length).toBeGreaterThan(0);
    expect(geminiModels.some((m) => m.id.includes('gemini-2.0-flash'))).toBe(true);

    const openRouterModels = await openrouter.listModels();
    expect(openRouterModels.length).toBeGreaterThan(0);
  });

  it('AIManager switches active providers dynamically', async () => {
    const secretStore = new StandardSecretStore();
    await secretStore.setSecret('openai', 'sk-test-key-12345');

    const manager = new AIManager({ activeProviderId: 'openai' }, secretStore);
    expect(manager.getActiveProviderId()).toBe('openai');

    const activeProv = await manager.getActiveProvider();
    expect(activeProv.id).toBe('openai');

    manager.setActiveProviderId('anthropic');
    expect(manager.getActiveProviderId()).toBe('anthropic');
    const anthropicProv = await manager.getActiveProvider();
    expect(anthropicProv.id).toBe('anthropic');
  });
});

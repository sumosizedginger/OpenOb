import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';

describe('OpenAICompatibleProvider Adapter (Phase 7)', () => {
  it('falls back cleanly to default model when endpoint is unreachable (Constitution Law 18)', async () => {
    const provider = new OpenAICompatibleProvider({
      endpointUrl: 'http://127.0.0.1:99999/v1', // Unreachable port
      defaultModel: 'llama3:latest',
    });

    const models = await provider.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('llama3:latest');
  });

  it('correctly reports streaming capabilities', async () => {
    const provider = new OpenAICompatibleProvider({
      endpointUrl: 'http://localhost:11434/v1',
    });

    const caps = await provider.capabilities('llama3');
    expect(caps.streaming).toBe(true);
    expect(caps.maxContextTokens).toBe(8192);
  });
});

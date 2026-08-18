import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';

describe('OpenAICompatibleProvider Adapter (Phase 7)', () => {
  it('truthfully throws when endpoint is unreachable (Constitution Law 18 / G3G-2)', async () => {
    const provider = new OpenAICompatibleProvider({
      endpointUrl: 'http://127.0.0.1:99999/v1', // Unreachable port
      defaultModel: 'llama3:latest',
    });

    await expect(provider.listModels()).rejects.toThrow();
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

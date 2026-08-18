import { AIModel, AIProvider, ChatRequest, AIChunk } from './types.js';
import { SecretStore, StandardSecretStore } from './secrets.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenRouterProvider } from './providers/openrouter.js';

export type AIProviderId = 'ollama' | 'lmstudio' | 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export interface AIManagerConfig {
  activeProviderId: AIProviderId;
  ollamaEndpoint?: string;
  lmStudioEndpoint?: string;
}

export class AIManager {
  private readonly secretStore: SecretStore;
  private activeProviderId: AIProviderId;
  private ollamaEndpoint: string;
  private lmStudioEndpoint: string;

  constructor(config: Partial<AIManagerConfig> = {}, secretStore?: SecretStore) {
    this.activeProviderId = config.activeProviderId || 'ollama';
    this.ollamaEndpoint = config.ollamaEndpoint || 'http://localhost:11434/v1';
    this.lmStudioEndpoint = config.lmStudioEndpoint || 'http://localhost:1234/v1';
    this.secretStore = secretStore || new StandardSecretStore();
  }

  getSecretStore(): SecretStore {
    return this.secretStore;
  }

  getActiveProviderId(): AIProviderId {
    return this.activeProviderId;
  }

  setActiveProviderId(id: AIProviderId): void {
    this.activeProviderId = id;
  }

  async getProvider(id: AIProviderId): Promise<AIProvider> {
    const apiKey = (await this.secretStore.getSecret(id)) || '';

    switch (id) {
      case 'openai':
        return new OpenAIProvider({ apiKey });

      case 'anthropic':
        return new AnthropicProvider({ apiKey });

      case 'gemini':
        return new GeminiProvider({ apiKey });

      case 'openrouter':
        return new OpenRouterProvider({ apiKey });

      case 'lmstudio':
        return new OpenAICompatibleProvider({
          endpointUrl: this.lmStudioEndpoint,
          defaultModel: 'local-model',
        });

      case 'ollama':
      default:
        return new OpenAICompatibleProvider({
          endpointUrl: this.ollamaEndpoint,
          defaultModel: 'llama3',
        });
    }
  }

  async getActiveProvider(): Promise<AIProvider> {
    return this.getProvider(this.activeProviderId);
  }

  async listModels(): Promise<AIModel[]> {
    const provider = await this.getActiveProvider();
    return await provider.listModels();
  }

  async *chat(request: ChatRequest): AsyncIterable<AIChunk> {
    const provider = await this.getActiveProvider();
    yield* provider.chat(request);
  }
}

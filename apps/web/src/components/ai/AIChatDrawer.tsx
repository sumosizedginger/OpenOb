import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AIModel,
  AIProviderId,
  AIProviderInfo,
  AIResponseMetadata,
  ChatMessage,
  Citation,
  cleanupLegacyBrowserSecrets,
  ProposedEdit,
  RetrievalScopeType,
} from '@okw/ai';
import { VaultPath } from '@okw/core';
import { AIBackend, WorkspaceBackend } from '@okw/workspace';
import {
  Bot,
  Send,
  Square,
  Sparkles,
  Settings,
  X,
  FileText,
  CheckCircle2,
  XCircle,
  Link,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export interface AIChatDrawerProps {
  aiBackend: AIBackend;
  workspaceBackend: WorkspaceBackend;
  activeNotePath?: VaultPath | null;
  activeNoteContent?: string;
  activeNoteVersion?: { token: string; hash?: string; modifiedAt?: number; size?: number };
  onNavigate: (path: VaultPath) => void;
  onApplyProposedEdit?: (proposal: ProposedEdit) => Promise<{ success: boolean; error?: string }>;
  onClose?: () => void;
}

const DEFAULT_PROVIDERS: AIProviderInfo[] = [
  { id: 'ollama', name: 'Ollama (Local)', type: 'local', configured: true },
  { id: 'lmstudio', name: 'LM Studio (Local)', type: 'local', configured: true },
  { id: 'openai', name: 'OpenAI', type: 'cloud', configured: false },
  { id: 'anthropic', name: 'Anthropic Claude', type: 'cloud', configured: false },
  { id: 'gemini', name: 'Google Gemini', type: 'cloud', configured: false },
  { id: 'openrouter', name: 'OpenRouter', type: 'cloud', configured: false },
];

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({
  aiBackend,
  workspaceBackend,
  activeNotePath,
  activeNoteContent,
  activeNoteVersion,
  onNavigate,
  onApplyProposedEdit,
  onClose,
}) => {
  const [providers, setProviders] = useState<AIProviderInfo[]>(DEFAULT_PROVIDERS);
  const [providerId, setProviderId] = useState<AIProviderId>(() => {
    return (localStorage.getItem('okw_ai_provider') as AIProviderId) || 'ollama';
  });

  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelError, setModelError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [scopeType, setScopeType] = useState<RetrievalScopeType>('current_note');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeProposal, setActiveProposal] = useState<ProposedEdit | null>(null);
  const [proposalConflictError, setProposalConflictError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [responseMetadata, setResponseMetadata] = useState<AIResponseMetadata | null>(null);

  // Secret settings
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [inputApiKey, setInputApiKey] = useState('');
  const [keySavedMessage, setKeySavedMessage] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Clean legacy browser sessionStorage secrets on startup (Constitution Law 17)
  useEffect(() => {
    cleanupLegacyBrowserSecrets();
  }, []);

  // Fetch available providers
  useEffect(() => {
    let isMounted = true;
    const loadProviders = async () => {
      try {
        const list = await aiBackend.listProviders();
        if (isMounted) {
          setProviders(list);
          if (list.length > 0 && !list.some((p) => p.id === providerId)) {
            setProviderId(list[0].id as AIProviderId);
          }
        }
      } catch (err: any) {
        console.error('Failed to load AI providers:', err);
      }
    };
    void loadProviders();
    return () => {
      isMounted = false;
    };
  }, [aiBackend, providerId]);

  const refreshProviderData = useCallback(async () => {
    setModelError(null);
    setModels([]);
    setSelectedModel('');
    setIsLoadingModels(true);

    try {
      const status = await aiBackend.getSecretStatus(providerId);
      setMaskedKey(status.masked ?? null);
    } catch {
      setMaskedKey(null);
    }

    try {
      const modelList = await aiBackend.listModels(providerId);
      setModels(modelList);
      setModelError(null);
      setIsLoadingModels(false);
      const defaultMod = modelList.find((m: AIModel) => m.isDefault) || modelList[0];
      if (defaultMod) {
        setSelectedModel(defaultMod.id);
      } else {
        setSelectedModel('');
      }
    } catch (err: any) {
      setModels([]);
      setSelectedModel('');
      setIsLoadingModels(false);
      setModelError(err?.message || 'AI provider unavailable');
    }
  }, [aiBackend, providerId]);

  // Sync active provider and abort any in-flight stream (P8-1)
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }

    localStorage.setItem('okw_ai_provider', providerId);
    setSecretError(null);

    void refreshProviderData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [providerId, refreshProviderData]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const handleSaveApiKey = async () => {
    if (!inputApiKey.trim()) return;
    setSecretError(null);
    try {
      await aiBackend.setSecret(providerId, inputApiKey.trim());
      setInputApiKey('');
      const status = await aiBackend.getSecretStatus(providerId);
      setMaskedKey(status.masked ?? null);
      setKeySavedMessage(true);
      setTimeout(() => setKeySavedMessage(false), 2000);

      // Refresh models with new key
      const modelList = await aiBackend.listModels(providerId);
      if (modelList.length > 0) {
        setModels(modelList);
        setSelectedModel(modelList[0].id);
      }
    } catch (err: any) {
      setSecretError(err.message || 'Failed to save secret');
    }
  };

  const handleClearApiKey = async () => {
    setSecretError(null);
    try {
      await aiBackend.clearSecret(providerId);
      setMaskedKey(null);
      setInputApiKey('');
    } catch (err: any) {
      setSecretError(err.message || 'Failed to clear secret');
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputPrompt.trim() || isGenerating || !selectedModel || !!modelError) return;

    const userQuery = inputPrompt.trim();
    setInputPrompt('');
    setProposalConflictError(null);

    const userMessage: ChatMessage = {
      role: 'user',
      content: userQuery,
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsGenerating(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let assistantResponse = '';

    try {
      const stream = aiBackend.chat({
        provider: providerId,
        model: selectedModel,
        messages: updatedMessages,
        retrievalScope: {
          type: scopeType,
          notePath: activeNotePath || undefined,
          folderPrefix: activeNotePath ? activeNotePath.split('/')[0] : undefined,
        },
        activeNoteContext: activeNotePath
          ? {
              path: activeNotePath,
              content: activeNoteContent || '',
              expectedVersion: activeNoteVersion,
            }
          : undefined,
        signal: abortController.signal,
      });

      // Add placeholder assistant message
      setMessages([...updatedMessages, { role: 'assistant', content: '' }]);

      for await (const chunkResp of stream) {
        assistantResponse += chunkResp.chunk.content;

        if (chunkResp.metadata) {
          setResponseMetadata(chunkResp.metadata);
        }

        if (chunkResp.proposal) {
          setActiveProposal(chunkResp.proposal);
        }

        setMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === 'assistant') {
            next[lastIdx] = {
              role: 'assistant',
              content: assistantResponse,
              citations: chunkResp.citations || next[lastIdx].citations,
            };
          }
          return next;
        });

        if (chunkResp.chunk.isDone) break;
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `⚠️ AI Request Failed: ${err.message}`,
          },
        ]);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleAcceptProposal = async () => {
    if (!activeProposal) return;
    setProposalConflictError(null);

    try {
      if (onApplyProposedEdit) {
        const res = await onApplyProposedEdit(activeProposal);
        if (!res.success) {
          setProposalConflictError(
            res.error || 'Conflict: Note changed since this proposal was generated.'
          );
          return;
        }
      } else {
        await workspaceBackend.updateNote({
          path: activeProposal.path,
          content: activeProposal.proposedContent,
          expectedVersion: activeProposal.expectedVersion
            ? {
                token: activeProposal.expectedVersion.token,
                hash: activeProposal.expectedVersion.hash,
                modifiedAt: activeProposal.expectedVersion.modifiedAt,
                size: activeProposal.expectedVersion.size,
              }
            : { token: '' },
        });
      }
      setActiveProposal(null);
    } catch (err: any) {
      setProposalConflictError(
        err.message || 'Conflict: Note changed since this proposal was generated.'
      );
    }
  };

  const currentProviderInfo = providers.find((p) => p.id === providerId);

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 border-l border-slate-800 select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-slate-200">AI Assistant</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono uppercase">
            {providerId}
          </span>
          {aiBackend.isGatewayMode && (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
              Gateway
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            title="BYOK & AI Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Settings Modal (BYOK & Provider Selection) */}
      {showSettings && (
        <div className="p-3 bg-slate-900/95 border-b border-slate-800 text-xs space-y-2.5 animate-in slide-in-from-top-1">
          <div className="font-semibold text-slate-200 flex items-center justify-between">
            <span>AI Provider & BYOK Keys</span>
            <button
              onClick={() => setShowSettings(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div>
            <label className="text-[11px] text-slate-400">Provider:</label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value as AIProviderId)}
              className="w-full mt-1 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-sky-500"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {currentProviderInfo?.type === 'cloud' && (
            <div className="space-y-1">
              {!aiBackend.isGatewayMode ? (
                <div className="p-2 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[11px] leading-snug">
                  Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application
                  state.
                </div>
              ) : (
                <>
                  <label className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>API Key (Stored in Gateway memory):</span>
                    {maskedKey && (
                      <span className="text-[10px] text-emerald-400 font-mono">{maskedKey}</span>
                    )}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="password"
                      placeholder={
                        maskedKey ? 'Enter new key to replace' : 'Paste API Key (sk-...)'
                      }
                      value={inputApiKey}
                      onChange={(e) => setInputApiKey(e.target.value)}
                      className="flex-1 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={handleSaveApiKey}
                      disabled={!inputApiKey.trim()}
                      className="px-2 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded text-white text-[11px]"
                    >
                      Save
                    </button>
                    {maskedKey && (
                      <button
                        onClick={handleClearApiKey}
                        className="px-2 py-1 bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 rounded text-[11px]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {keySavedMessage && (
                    <div className="text-[10px] text-emerald-400">
                      ✓ Key securely configured in Gateway
                    </div>
                  )}
                  {secretError && <div className="text-[10px] text-rose-400">⚠️ {secretError}</div>}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scope & Model Selector Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/60 border-b border-slate-800 text-[11px]">
        {/* Scope Selector */}
        <div className="flex items-center gap-1 text-slate-400">
          <span className="text-[10px]">Scope:</span>
          <select
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as RetrievalScopeType)}
            className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="current_note">Current Note</option>
            <option value="folder">Current Folder</option>
            <option value="vault">Whole Vault</option>
          </select>
        </div>

        {/* Model Selector */}
        <div className="flex items-center gap-1 text-slate-400">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isLoadingModels || !!modelError || models.length === 0}
            className="bg-slate-950 border border-slate-700 disabled:opacity-50 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none cursor-pointer max-w-[130px] truncate"
          >
            {isLoadingModels ? (
              <option value="">Loading...</option>
            ) : modelError ? (
              <option value="">Unavailable</option>
            ) : models.length === 0 ? (
              <option value="">No models</option>
            ) : (
              models.map((m: AIModel) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Provider Model Discovery Error Banner */}
      {modelError && (
        <div className="px-3 py-1.5 bg-rose-950/60 border-b border-rose-800/80 text-rose-300 text-[11px] flex items-center justify-between">
          <span className="truncate flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">{modelError}</span>
          </span>
          <button
            onClick={() => void refreshProviderData()}
            className="ml-2 px-1.5 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-[10px] text-white shrink-0 flex items-center gap-1"
          >
            <RefreshCw className="w-2.5 h-2.5" /> Retry
          </button>
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-slate-500 text-xs space-y-2">
            <Sparkles className="w-6 h-6 mx-auto text-sky-400/60" />
            <p>Ask anything about your notes or request changes.</p>
            <div className="text-[11px] text-slate-600">
              Cloud BYOK & Local AI supported with strict secret protection.
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`p-2.5 rounded-xl text-xs max-w-[90%] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-sky-600 text-white rounded-br-none'
                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content || '...'}</div>

              {/* Clickable Citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex flex-wrap gap-1">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Link className="w-2.5 h-2.5 text-sky-400" /> Citations
                    {responseMetadata?.retrievedSources &&
                    responseMetadata.retrievedSources.length > 0
                      ? ` (${responseMetadata.retrievedSources.length} sources):`
                      : ':'}
                  </span>
                  {msg.citations.map((cite: Citation, cIdx: number) => (
                    <button
                      key={cIdx}
                      onClick={() => onNavigate(cite.notePath)}
                      className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 hover:bg-sky-950 text-sky-300 border border-slate-700/60 transition-colors"
                    >
                      {cite.noteTitle} {cite.lineStart ? `(L${cite.lineStart})` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Proposed Edit Card */}
        {activeProposal && (
          <div className="p-3 bg-slate-900 border border-sky-600/50 rounded-xl shadow-lg space-y-2 text-xs animate-in fade-in">
            <div className="flex items-center justify-between font-semibold text-sky-300">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Proposed Note Edit
              </span>
              <span className="text-[10px] text-slate-400">{activeProposal.path}</span>
            </div>

            <div className="text-slate-400 text-[11px]">{activeProposal.explanation}</div>

            {/* OCC Conflict Notice */}
            {proposalConflictError && (
              <div className="p-2 rounded bg-rose-950/70 border border-rose-800/80 text-rose-300 text-[11px] space-y-1.5">
                <div className="flex items-center gap-1 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Note changed since proposal was generated</span>
                </div>
                <div className="text-[10px] text-rose-200/80">{proposalConflictError}</div>
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    onClick={() => {
                      onNavigate(activeProposal.path);
                    }}
                    className="px-2 py-0.5 bg-rose-900/60 hover:bg-rose-800 rounded text-[10px] text-rose-200 flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Reload Note
                  </button>
                  <button
                    onClick={() => {
                      setActiveProposal(null);
                      setProposalConflictError(null);
                    }}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300"
                  >
                    Discard Proposal
                  </button>
                </div>
              </div>
            )}

            {!proposalConflictError && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAcceptProposal}
                  className="flex-1 py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium flex items-center justify-center gap-1 shadow-sm transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Accept Edit</span>
                </button>
                <button
                  onClick={() => setActiveProposal(null)}
                  className="py-1 px-2.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 flex items-center justify-center gap-1 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSendMessage} className="p-2.5 bg-slate-900 border-t border-slate-800">
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 focus-within:border-sky-500 rounded-xl px-2.5 py-1.5">
          <input
            type="text"
            placeholder={
              scopeType === 'current_note'
                ? 'Ask about current note...'
                : 'Ask across selected scope...'
            }
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            disabled={isGenerating}
            className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
          />

          {isGenerating ? (
            <button
              type="button"
              onClick={handleStopGeneration}
              className="p-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              title="Stop Generation"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputPrompt.trim() || !selectedModel || !!modelError}
              className="p-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-colors"
              title="Send Prompt"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

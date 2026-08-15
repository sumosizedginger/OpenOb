import React, { useState, useEffect, useRef } from 'react';
import {
  AIManager,
  AIModel,
  AIProviderId,
  ChatMessage,
  Citation,
  ProposedEdit,
  RetrievalScope,
  RetrievalScopeType,
  StandardSecretStore,
  extractCitations,
  formatContextPrompt,
  parseProposedEditFromResponse,
  retrieveContext,
} from '@okw/ai';
import { DocumentIndex, VaultPath, VaultStorage } from '@okw/core';
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
} from 'lucide-react';

interface AIChatDrawerProps {
  storage: VaultStorage;
  index: DocumentIndex;
  activeNotePath?: VaultPath | null;
  activeNoteContent?: string;
  onNavigate: (path: VaultPath) => void;
  onApplyProposedEdit: (proposal: ProposedEdit) => Promise<void>;
  onClose?: () => void;
}

const secretStore = new StandardSecretStore();

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({
  storage,
  index,
  activeNotePath,
  activeNoteContent,
  onNavigate,
  onApplyProposedEdit,
  onClose,
}) => {
  const [providerId, setProviderId] = useState<AIProviderId>(() => {
    return (localStorage.getItem('okw_ai_provider') as AIProviderId) || 'ollama';
  });

  const [aiManager] = useState<AIManager>(() => new AIManager({ activeProviderId: providerId }, secretStore));
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [scopeType, setScopeType] = useState<RetrievalScopeType>('current_note');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeProposal, setActiveProposal] = useState<ProposedEdit | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<{ path: VaultPath; title: string }[]>([]);

  // Secret settings
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [inputApiKey, setInputApiKey] = useState('');
  const [keySavedMessage, setKeySavedMessage] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync active provider and abort any in-flight stream (P8-1)
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }

    aiManager.setActiveProviderId(providerId);
    localStorage.setItem('okw_ai_provider', providerId);

    const refreshProviderData = async () => {
      const masked = await secretStore.getMaskedSecret(providerId);
      setMaskedKey(masked);

      try {
        const modelList = await aiManager.listModels();
        setModels(modelList);
        const defaultMod = modelList.find((m: AIModel) => m.isDefault) || modelList[0];
        if (defaultMod) {
          setSelectedModel(defaultMod.id);
        }
      } catch {
        setModels([{ id: 'default', name: 'Default Model' }]);
      }
    };

    refreshProviderData();
  }, [providerId, aiManager]);

  // Load available documents for citation matching
  useEffect(() => {
    let isMounted = true;
    const initDocs = async () => {
      try {
        const docs = await index.getAll();
        if (isMounted) {
          setAvailableDocs(docs.map((d) => ({ path: d.path, title: d.title })));
        }
      } catch {}
    };

    initDocs();
    return () => {
      isMounted = false;
    };
  }, [index]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const handleSaveApiKey = async () => {
    if (!inputApiKey.trim()) return;
    await secretStore.setSecret(providerId, inputApiKey.trim());
    setInputApiKey('');
    const masked = await secretStore.getMaskedSecret(providerId);
    setMaskedKey(masked);
    setKeySavedMessage(true);
    setTimeout(() => setKeySavedMessage(false), 2000);

    // Refresh models with new key
    const modelList = await aiManager.listModels();
    if (modelList.length > 0) {
      setModels(modelList);
      setSelectedModel(modelList[0].id);
    }
  };

  const handleClearApiKey = async () => {
    await secretStore.clearSecret(providerId);
    setMaskedKey(null);
    setInputApiKey('');
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputPrompt.trim() || isGenerating) return;

    const userQuery = inputPrompt.trim();
    setInputPrompt('');

    // 1. Build Scope & Retrieve Context
    const scope: RetrievalScope = {
      type: scopeType,
      notePath: activeNotePath || undefined,
      folderPrefix: activeNotePath ? activeNotePath.split('/')[0] : undefined,
    };

    const retrieved = await retrieveContext(storage, index, userQuery, scope);
    const contextPrompt = formatContextPrompt(retrieved);

    const systemMessage: ChatMessage = {
      role: 'system',
      content:
        'You are an intelligent AI assistant integrated into Open Knowledge Workspace. You help the user summarize, connect, and edit their notes. Always ground your answers in the provided Vault Context.\n\n' +
        contextPrompt,
    };

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
      const stream = aiManager.chat({
        model: selectedModel,
        messages: [systemMessage, ...updatedMessages],
        signal: abortController.signal,
      });

      // Add placeholder assistant message
      setMessages([...updatedMessages, { role: 'assistant', content: '' }]);

      for await (const chunk of stream) {
        assistantResponse += chunk.content;

        setMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === 'assistant') {
            next[lastIdx] = {
              role: 'assistant',
              content: assistantResponse,
              citations: extractCitations(assistantResponse, availableDocs),
            };
          }
          return next;
        });

        if (chunk.isDone) break;
      }

      // Check if response contains a proposed edit
      if (activeNotePath && activeNoteContent) {
        const proposal = parseProposedEditFromResponse(
          assistantResponse,
          activeNotePath,
          activeNoteContent
        );
        if (proposal) {
          setActiveProposal(proposal);
        }
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
    await onApplyProposedEdit(activeProposal);
    setActiveProposal(null);
  };

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
            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-200">
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
              <option value="ollama">Ollama (Local)</option>
              <option value="lmstudio">LM Studio (Local)</option>
              <option value="openai">OpenAI (BYOK)</option>
              <option value="anthropic">Anthropic Claude (BYOK)</option>
              <option value="gemini">Google Gemini (BYOK)</option>
              <option value="openrouter">OpenRouter (BYOK)</option>
            </select>
          </div>

          {providerId !== 'ollama' && providerId !== 'lmstudio' && (
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>API Key:</span>
                {maskedKey && <span className="text-[10px] text-emerald-400 font-mono">{maskedKey}</span>}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  placeholder={maskedKey ? 'Enter new key to replace' : 'Paste API Key (sk-...)'}
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
              {keySavedMessage && <div className="text-[10px] text-emerald-400">✓ Key securely saved</div>}
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
            className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none cursor-pointer max-w-[130px] truncate"
          >
            {models.map((m: AIModel) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

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
            className={`flex flex-col gap-1.5 ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
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
                    <Link className="w-2.5 h-2.5 text-sky-400" /> Citations:
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
              disabled={!inputPrompt.trim()}
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

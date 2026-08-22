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
  Bot,
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        userSelect: 'none',
        backgroundColor: 'var(--surface-sidebar)',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Bot size={15} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            AI Assistant
          </span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-canvas)',
              color: 'var(--accent-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {providerId}
          </span>
          {aiBackend.isGatewayMode && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                color: 'var(--status-success)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
              }}
            >
              Gateway
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="btn-icon"
            style={{ width: '22px', height: '22px' }}
            title="BYOK & AI Settings"
          >
            <Settings size={12} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="btn-icon"
              style={{ width: '22px', height: '22px' }}
              title="Close AI Assistant"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Settings Modal (BYOK & Provider Selection) */}
      {showSettings && (
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--surface-elevated)',
            borderBottom: '1px solid var(--border-medium)',
            fontSize: '11px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            <span>AI Provider & BYOK Settings</span>
            <button
              onClick={() => setShowSettings(false)}
              className="btn-icon"
              style={{ width: '16px', height: '16px' }}
            >
              <X size={11} />
            </button>
          </div>

          <div>
            <label style={{ color: 'var(--text-muted)' }}>Provider:</label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value as AIProviderId)}
              style={{
                width: '100%',
                marginTop: '3px',
                padding: '4px 6px',
                backgroundColor: 'var(--surface-canvas)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {currentProviderInfo?.type === 'cloud' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {!aiBackend.isGatewayMode ? (
                <div
                  style={{
                    padding: '6px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    color: 'var(--status-warning)',
                    fontSize: '11px',
                  }}
                >
                  Cloud BYOK requires OpenOb Gateway so API keys remain outside browser application
                  state.
                </div>
              ) : (
                <>
                  <label
                    style={{
                      color: 'var(--text-muted)',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>API Key (Stored in Gateway memory):</span>
                    {maskedKey && (
                      <span
                        style={{ color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}
                      >
                        {maskedKey}
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="password"
                      placeholder={
                        maskedKey ? 'Enter new key to replace' : 'Paste API Key (sk-...)'
                      }
                      value={inputApiKey}
                      onChange={(e) => setInputApiKey(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        backgroundColor: 'var(--surface-canvas)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <button
                      onClick={handleSaveApiKey}
                      disabled={!inputApiKey.trim()}
                      className="btn btn-primary"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                    >
                      Save
                    </button>
                    {maskedKey && (
                      <button
                        onClick={handleClearApiKey}
                        className="btn"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {keySavedMessage && (
                    <div style={{ color: 'var(--status-success)', fontSize: '10px' }}>
                      ✓ Key securely saved in Gateway
                    </div>
                  )}
                  {secretError && (
                    <div style={{ color: 'var(--status-danger)', fontSize: '10px' }}>
                      ⚠️ {secretError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controls Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '11px',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
          <select
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as RetrievalScopeType)}
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--surface-canvas)',
              color: 'var(--text-secondary)',
              maxWidth: '120px',
            }}
          >
            <option value="current_note">Current Note</option>
            <option value="folder">Folder</option>
            <option value="vault">Whole Vault</option>
          </select>

          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isLoadingModels || !!modelError || models.length === 0}
            style={{
              flex: 1,
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--surface-canvas)',
              color: 'var(--text-secondary)',
            }}
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

      {/* Provider Model Error Banner */}
      {modelError && (
        <div
          style={{
            padding: '6px 8px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
            color: 'var(--status-danger)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <AlertTriangle size={12} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {modelError}
            </span>
          </span>
          <button
            onClick={() => void refreshProviderData()}
            className="btn"
            style={{ padding: '1px 6px', fontSize: '10px', height: '20px' }}
          >
            <RefreshCw size={10} /> Retry
          </button>
        </div>
      )}

      {/* Messages Feed */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '32px 12px',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Sparkles size={24} style={{ opacity: 0.3, color: 'var(--accent-primary)' }} />
            <p>Ask anything about your notes or propose changes.</p>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              100% local or self-hosted gateway AI with zero vendor lock-in.
            </span>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              gap: '4px',
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius-lg)',
                fontSize: '12px',
                lineHeight: '1.5',
                maxWidth: '90%',
                backgroundColor:
                  msg.role === 'user' ? 'var(--surface-selected)' : 'var(--surface-canvas)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content || '...'}</div>

              {/* Citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div
                  style={{
                    marginTop: '6px',
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <Link size={9} /> Citations
                    {responseMetadata?.retrievedSources &&
                    responseMetadata.retrievedSources.length > 0
                      ? ` (${responseMetadata.retrievedSources.length} sources):`
                      : ':'}
                  </span>
                  {msg.citations.map((cite: Citation, cIdx: number) => (
                    <button
                      key={cIdx}
                      onClick={() => onNavigate(cite.notePath)}
                      style={{
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '10px',
                        backgroundColor: 'var(--surface-sidebar)',
                        color: 'var(--accent-primary)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                      }}
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
          <div
            style={{
              padding: '10px',
              backgroundColor: 'var(--surface-canvas)',
              border: '1px solid var(--border-focus)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: 'var(--accent-primary)',
                fontWeight: 600,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <FileText size={13} /> Proposed Note Edit
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {activeProposal.path}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {activeProposal.explanation}
            </div>

            {/* OCC Conflict Notice */}
            {proposalConflictError && (
              <div
                style={{
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: 'var(--status-danger)',
                  fontSize: '11px',
                }}
              >
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={12} /> Note changed since proposal was generated
                </div>
                <div style={{ fontSize: '10px', marginTop: '2px' }}>{proposalConflictError}</div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                  <button
                    onClick={() => onNavigate(activeProposal.path)}
                    className="btn"
                    style={{ padding: '2px 6px', fontSize: '10px' }}
                  >
                    <RefreshCw size={10} /> Reload Note
                  </button>
                  <button
                    onClick={() => {
                      setActiveProposal(null);
                      setProposalConflictError(null);
                    }}
                    className="btn btn-ghost"
                    style={{ padding: '2px 6px', fontSize: '10px' }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            {!proposalConflictError && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <button
                  onClick={handleAcceptProposal}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '4px 8px', fontSize: '11px' }}
                >
                  <CheckCircle2 size={12} /> Accept Edit
                </button>
                <button
                  onClick={() => setActiveProposal(null)}
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                >
                  <XCircle size={12} /> Reject
                </button>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form
        onSubmit={handleSendMessage}
        style={{
          padding: '8px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-sidebar)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'var(--surface-canvas)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '4px 8px',
          }}
        >
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
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '12px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />

          {isGenerating ? (
            <button
              type="button"
              onClick={handleStopGeneration}
              className="btn"
              style={{
                padding: '4px',
                backgroundColor: 'var(--status-danger)',
                borderColor: 'var(--status-danger)',
                color: '#fff',
              }}
              title="Stop Generation"
            >
              <Square size={11} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputPrompt.trim() || !selectedModel || !!modelError}
              className="btn btn-primary"
              style={{ padding: '4px 8px', height: '26px' }}
              title="Send Prompt"
            >
              <Send size={11} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

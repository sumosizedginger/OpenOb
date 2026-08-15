import { VaultPath, VaultStorage } from '@okw/core';
import { SafeWriter } from '@okw/vault';
import { ProposedEdit } from './types.js';

/**
 * Extracts a structured ProposedEdit from an AI response (Constitution Law 19).
 */
export function parseProposedEditFromResponse(
  aiResponse: string,
  targetPath: VaultPath,
  originalContent: string
): ProposedEdit | null {
  // 1. Look for ```proposal:path.md or ```markdown codeblock with new content
  const proposalMatch =
    aiResponse.match(/```(?:proposal(?::([^\n]+))?|markdown|md)\r?\n([\s\S]*?)\r?\n```/) ||
    aiResponse.match(/```[a-z]*\r?\n([\s\S]*?)\r?\n```/);

  if (!proposalMatch) {
    return null;
  }

  // Always bind strictly to targetPath to prevent prompt-injection attacks targeting arbitrary vault files (F-029, P7-2)
  const targetNotePath = targetPath;
  const proposedContent = proposalMatch[2] || proposalMatch[1];

  if (!proposedContent || proposedContent.trim() === originalContent.trim()) {
    return null;
  }

  // Extract explanation from preceding or following text
  const explanation =
    aiResponse.replace(proposalMatch[0], '').trim().slice(0, 300) ||
    'AI proposed modifications to note content';

  return {
    id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    path: targetNotePath,
    originalContent,
    proposedContent,
    explanation,
    createdAt: Date.now(),
  };
}

/**
 * Safely applies an approved ProposedEdit to disk via SafeWriter (Constitution Law 19).
 */
export async function applyProposedEdit(
  storage: VaultStorage,
  safeWriter: SafeWriter,
  proposal: ProposedEdit
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentSnap = await storage.read(proposal.path);
    const currentText =
      typeof currentSnap.content === 'string'
        ? currentSnap.content
        : new TextDecoder().decode(currentSnap.content);

    // Concurrency check: Ensure the file hasn't diverged since proposal generation (F-028, P7-1)
    if (currentText.trim() !== proposal.originalContent.trim()) {
      return {
        success: false,
        error: 'Conflict: Note content was modified after proposal was generated.',
      };
    }

    await safeWriter.safeSave(proposal.path, proposal.proposedContent, {
      expectedVersion: currentSnap.version,
    });

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to apply proposed edit: ${err.message}`,
    };
  }
}

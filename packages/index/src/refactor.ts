import {
  basenameVaultPath,
  dirnameVaultPath,
  DocumentIndex,
  DocumentParser,
  FileSnapshot,
  normalizeVaultPath,
  VaultPath,
  VaultStorage,
} from '@okw/core';

export interface RenameResult {
  oldPath: VaultPath;
  newPath: VaultPath;
  updatedFiles: VaultPath[];
  rewrittenLinkCount: number;
}

export interface RenameOptions {
  updateLinks?: boolean;
}

/**
 * Rewrites a single raw wikilink target while preserving subpath and alias.
 * Example: rewriteWikilinkTarget("[[OldNote#Heading|Alias]]", "NewNote") -> "[[NewNote#Heading|Alias]]"
 */
export function rewriteWikilinkTarget(
  rawLink: string,
  newTarget: string
): string {
  const isEmbed = rawLink.startsWith('!');
  const inner = isEmbed ? rawLink.slice(3, -2) : rawLink.slice(2, -2);

  const hashIdx = inner.indexOf('#');
  const pipeIdx = inner.indexOf('|');

  let subpath = '';
  let alias = '';

  if (hashIdx !== -1) {
    if (pipeIdx !== -1 && pipeIdx > hashIdx) {
      subpath = inner.slice(hashIdx, pipeIdx);
      alias = inner.slice(pipeIdx);
    } else {
      subpath = inner.slice(hashIdx);
    }
  } else if (pipeIdx !== -1) {
    alias = inner.slice(pipeIdx);
  }

  const prefix = isEmbed ? '!' : '';
  return `${prefix}[[${newTarget}${subpath}${alias}]]`;
}

/**
 * Block-aware wikilink rewriting (P4-4).
 * Protects YAML frontmatter, fenced code blocks (``` / ~~~), and inline code (`...`).
 */
export function rewriteNoteWikilinks(
  content: string,
  resolver: (targetName: string) => { match: boolean; newTarget: string }
): { content: string; rewrittenCount: number } {
  let rewrittenCount = 0;

  // Protect frontmatter, fenced code blocks, and inline code spans
  const protectedPattern = /^(---[\s\S]*?\n---)|(```[\s\S]*?```)|(~~~[\s\S]*?~~~)|(`[^`\n]+`)/gm;

  let lastIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;

  const rewriteSegment = (seg: string): string => {
    const linkRegex = /!?\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
    return seg.replace(linkRegex, (m, targetName) => {
      const decision = resolver(targetName.trim());
      if (decision.match) {
        rewrittenCount++;
        return rewriteWikilinkTarget(m, decision.newTarget);
      }
      return m;
    });
  };

  while ((match = protectedPattern.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index);
    result += rewriteSegment(textBefore);
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    result += rewriteSegment(content.slice(lastIndex));
  }

  return { content: result, rewrittenCount };
}

/**
 * Safely renames a markdown note and refactors all incoming wikilinks across the vault.
 * Hardened against F-001 silent overwrites, partial write failures, and code block corruptions (P4-1, P4-2, P4-4).
 */
export async function renameDocument(
  storage: VaultStorage,
  index: DocumentIndex,
  parser: DocumentParser,
  oldPath: VaultPath,
  newPath: VaultPath,
  options: RenameOptions = { updateLinks: true }
): Promise<RenameResult> {
  const normOldPath = normalizeVaultPath(oldPath);
  const normNewPath = normalizeVaultPath(newPath.endsWith('.md') ? newPath : `${newPath}.md`);

  if (normOldPath === normNewPath) {
    return {
      oldPath: normOldPath,
      newPath: normNewPath,
      updatedFiles: [],
      rewrittenLinkCount: 0,
    };
  }

  // 1. Dry run & Snapshot capture (P4-1 & P4-2)
  const oldSnapshot = await storage.read(normOldPath);
  if (!oldSnapshot) {
    throw new Error(`Cannot rename non-existent note: ${normOldPath}`);
  }

  const targetExists = await storage.exists(normNewPath);
  if (targetExists) {
    throw new Error(`Target path already exists: ${normNewPath}`);
  }

  const oldText = typeof oldSnapshot.content === 'string'
    ? oldSnapshot.content
    : new TextDecoder().decode(oldSnapshot.content);

  const newBasename = basenameVaultPath(normNewPath, '.md');
  const updatedFiles: VaultPath[] = [];
  let totalRewrittenCount = 0;

  // 2. Prepare self-references rewrite in renamed document
  let renamedNoteContent = oldText;
  if (options.updateLinks) {
    const selfRewrite = rewriteNoteWikilinks(oldText, (targetName) => {
      const res = index.resolveLink(normOldPath, targetName);
      if (res.resolved && res.targetPath === normOldPath) {
        return { match: true, newTarget: newBasename };
      }
      return { match: false, newTarget: '' };
    });
    renamedNoteContent = selfRewrite.content;
    totalRewrittenCount += selfRewrite.rewrittenCount;
  }

  // 3. Move target file on disk first (P4-2 ordering)
  // Concurrency check: expectedVersion null prevents overwriting an unexpected file
  await storage.write(normNewPath, null, renamedNoteContent);
  await storage.remove(normOldPath);

  // 4. Concurrency-checked reference refactoring with rollback journal (P4-1, P4-2)
  if (options.updateLinks) {
    const backlinks = await index.getBacklinks(normOldPath);
    const referencingPaths = Array.from(new Set(backlinks.map((b) => b.sourcePath))).filter(
      (p) => p !== normOldPath
    );

    const rollbackList: Array<{ path: VaultPath; originalSnapshot: FileSnapshot }> = [];

    try {
      for (const sourcePath of referencingPaths) {
        const sourceSnapshot = await storage.read(sourcePath);
        const sourceText = typeof sourceSnapshot.content === 'string'
          ? sourceSnapshot.content
          : new TextDecoder().decode(sourceSnapshot.content);

        const { content: rewrittenText, rewrittenCount } = rewriteNoteWikilinks(
          sourceText,
          (targetName) => {
            const res = index.resolveLink(sourcePath, targetName);
            if (res.resolved && res.targetPath === normOldPath) {
              let replacementTarget = newBasename;
              if (targetName.includes('/')) {
                const sourceDir = dirnameVaultPath(sourcePath);
                if (targetName.startsWith(sourceDir ? `${sourceDir}/` : '')) {
                  replacementTarget = newBasename;
                } else {
                  replacementTarget = normNewPath.replace(/\.md$/, '');
                }
              }
              return { match: true, newTarget: replacementTarget };
            }
            return { match: false, newTarget: '' };
          }
        );

        if (rewrittenCount > 0) {
          // P4-1 CRITICAL FIX: Use sourceSnapshot.version to prevent silent concurrent overwrites!
          await storage.write(sourcePath, sourceSnapshot.version, rewrittenText);
          rollbackList.push({ path: sourcePath, originalSnapshot: sourceSnapshot });
          const parsed = await parser.parse(sourcePath, rewrittenText);
          await index.upsert(parsed);
          updatedFiles.push(sourcePath);
          totalRewrittenCount += rewrittenCount;
        }
      }
    } catch (err) {
      // Rollback modified referencing files to original snapshot states
      for (const rb of rollbackList) {
        try {
          const originalText = typeof rb.originalSnapshot.content === 'string'
            ? rb.originalSnapshot.content
            : new TextDecoder().decode(rb.originalSnapshot.content);
          await storage.write(rb.path, undefined, originalText);
          const parsed = await parser.parse(rb.path, originalText);
          await index.upsert(parsed);
        } catch {}
      }
      // Rollback moved file
      try {
        await storage.write(normOldPath, undefined, oldText);
        await storage.remove(normNewPath);
      } catch {}
      throw err;
    }
  }

  // 5. Update index state for renamed note
  await index.remove(normOldPath);
  const newParsedDoc = await parser.parse(normNewPath, renamedNoteContent);
  await index.upsert(newParsedDoc);

  return {
    oldPath: normOldPath,
    newPath: normNewPath,
    updatedFiles,
    rewrittenLinkCount: totalRewrittenCount,
  };
}

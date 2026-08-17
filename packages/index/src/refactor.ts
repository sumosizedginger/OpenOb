import {
  basenameVaultPath,
  ConflictError,
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
export function rewriteWikilinkTarget(rawLink: string, newTarget: string): string {
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
 * Block-aware wikilink rewriting (P4-4 & P4-4R).
 * Strictly isolates YAML frontmatter at index 0 and protects fenced (``` / ~~~) and inline (`...`) code blocks.
 */
export function rewriteNoteWikilinks(
  content: string,
  resolver: (targetName: string) => { match: boolean; newTarget: string }
): { content: string; rewrittenCount: number } {
  let rewrittenCount = 0;

  // 1. Separate YAML frontmatter if present at index 0 (P4-4R)
  let frontmatter = '';
  let body = content;

  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (fmMatch && fmMatch.index === 0) {
    frontmatter = fmMatch[0];
    body = content.slice(frontmatter.length);
  }

  // 2. Protect fenced code blocks (``` / ~~~) and inline code spans (`...`)
  const codeBlockPattern = /(```[\s\S]*?```)|(~~~[\s\S]*?~~~)|(`[^`\n]+`)/g;

  let lastIndex = 0;
  let resultBody = '';
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

  while ((match = codeBlockPattern.exec(body)) !== null) {
    const textBefore = body.slice(lastIndex, match.index);
    resultBody += rewriteSegment(textBefore);
    resultBody += match[0];
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    resultBody += rewriteSegment(body.slice(lastIndex));
  }

  return { content: frontmatter + resultBody, rewrittenCount };
}

/**
 * Safely renames a markdown note and refactors all incoming wikilinks across the vault.
 * Hardened against F-001 silent overwrites, partial write failures, and code block corruptions (P4-1, P4-1R, P4-2, P4-4, P4-4R).
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

  const oldText =
    typeof oldSnapshot.content === 'string'
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

  // 3. Move target file on disk with pre-delete version re-check (P4-1R, P4-2)
  await storage.write(normNewPath, null, renamedNoteContent);

  const preDeleteStat = await storage.stat(normOldPath);
  if (
    preDeleteStat?.version &&
    preDeleteStat.version.token !== oldSnapshot.version.token &&
    preDeleteStat.version.hash !== oldSnapshot.version.hash
  ) {
    // Abort and rollback newly written file to prevent destroying concurrent external edit (P4-1R)
    await storage.remove(normNewPath);
    throw new ConflictError(
      normOldPath,
      oldSnapshot.version,
      preDeleteStat.version,
      undefined,
      `Safe rename aborted: "${normOldPath}" was modified externally prior to deletion.`
    );
  }

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
        const sourceText =
          typeof sourceSnapshot.content === 'string'
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
                if (sourceDir && targetName.startsWith(`${sourceDir}/`)) {
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
          const originalText =
            typeof rb.originalSnapshot.content === 'string'
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

import {
  basenameVaultPath,
  dirnameVaultPath,
  DocumentIndex,
  DocumentParser,
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
 * Safely renames a markdown note and refactors all incoming wikilinks across the vault.
 * Preserves subpaths, custom display text/aliases, and original CRLF/LF line endings (F-010, F-011, D-012).
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

  // 1. Verify old file exists and new file does not collide
  const oldExists = await storage.exists(normOldPath);
  if (!oldExists) {
    throw new Error(`Cannot rename non-existent note: ${normOldPath}`);
  }

  const targetExists = await storage.exists(normNewPath);
  if (targetExists) {
    throw new Error(`Target path already exists: ${normNewPath}`);
  }

  const oldContent = await storage.readText(normOldPath);

  const updatedFiles: VaultPath[] = [];
  let rewrittenLinkCount = 0;

  const newBasename = basenameVaultPath(normNewPath, '.md');

  // 2. Identify incoming backlinks to oldPath
  if (options.updateLinks) {
    const backlinks = await index.getBacklinks(normOldPath);
    const referencingPaths = new Set(backlinks.map((b) => b.sourcePath));

    for (const sourcePath of referencingPaths) {
      if (sourcePath === normOldPath) continue; // Self-links handled separately

      const content = await storage.readText(sourcePath);
      let fileModified = false;

      // Match wikilinks [[Target#Subpath|Alias]]
      const linkRegex = /!?\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;

      const newContent = content.replace(linkRegex, (match, targetName) => {
        const trimmedTarget = targetName.trim();
        const res = index.resolveLink(sourcePath, trimmedTarget);

        if (res.resolved && res.targetPath === normOldPath) {
          fileModified = true;
          rewrittenLinkCount++;

          // Choose target string format: if target was relative or path-qualified, retain appropriate relative/clean path
          let replacementTarget = newBasename;
          if (trimmedTarget.includes('/')) {
            // Target was path-qualified, use new relative or normalized path
            const sourceDir = dirnameVaultPath(sourcePath);
            if (trimmedTarget.startsWith(sourceDir ? `${sourceDir}/` : '')) {
              replacementTarget = newBasename;
            } else {
              replacementTarget = normNewPath.replace(/\.md$/, '');
            }
          }

          return rewriteWikilinkTarget(match, replacementTarget);
        }
        return match;
      });

      if (fileModified) {
        await storage.write(sourcePath, undefined, newContent);
        const parsed = await parser.parse(sourcePath, newContent);
        await index.upsert(parsed);
        updatedFiles.push(sourcePath);
      }
    }
  }

  // 3. Handle self-references inside the document being renamed
  let noteContent = oldContent;
  if (options.updateLinks) {
    const linkRegex = /!?\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
    noteContent = noteContent.replace(linkRegex, (match, targetName) => {
      const trimmedTarget = targetName.trim();
      const res = index.resolveLink(normOldPath, trimmedTarget);
      if (res.resolved && res.targetPath === normOldPath) {
        rewrittenLinkCount++;
        return rewriteWikilinkTarget(match, newBasename);
      }
      return match;
    });
  }

  // 4. Move file in storage
  await storage.write(normNewPath, undefined, noteContent);
  await storage.remove(normOldPath);

  // 5. Update index
  await index.remove(normOldPath);
  const newParsedDoc = await parser.parse(normNewPath, noteContent);
  await index.upsert(newParsedDoc);

  return {
    oldPath: normOldPath,
    newPath: normNewPath,
    updatedFiles,
    rewrittenLinkCount,
  };
}

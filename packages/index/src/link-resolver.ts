import {
  basenameVaultPath,
  dirnameVaultPath,
  joinVaultPath,
  LinkResolution,
  LinkResolver,
  normalizeVaultPath,
  ParsedDocument,
  VaultPath,
} from '@okw/core';

/**
 * Authoritative Link Resolver.
 * Resolves wikilink targets to canonical vault paths in deterministic order.
 */
export class DefaultLinkResolver implements LinkResolver {
  constructor(private readonly getDocuments: () => ParsedDocument[]) {}

  resolve(sourcePath: VaultPath, rawTarget: string): LinkResolution {
    const target = rawTarget.trim();
    if (!target) {
      return { resolved: false };
    }

    const docs = this.getDocuments();
    const sourceDir = dirnameVaultPath(sourcePath);

    // 1. Exact relative path from source document's directory
    if (sourceDir) {
      const relPathWithExt = joinVaultPath(sourceDir, target.endsWith('.md') ? target : `${target}.md`);
      const match = docs.find((d) => d.path === relPathWithExt);
      if (match) {
        return { resolved: true, targetPath: match.path };
      }
    }

    // 2. Exact path from vault root
    const rootPathWithExt = normalizeVaultPath(target.endsWith('.md') ? target : `${target}.md`);
    const rootMatch = docs.find((d) => d.path === rootPathWithExt);
    if (rootMatch) {
      return { resolved: true, targetPath: rootMatch.path };
    }

    // 3. Match basename anywhere in vault
    const targetBaseName = target.replace(/\.md$/i, '').toLowerCase();
    const basenameMatches = docs.filter((d) => {
      const docBase = basenameVaultPath(d.path, '.md').toLowerCase();
      return docBase === targetBaseName;
    });

    if (basenameMatches.length === 1) {
      return { resolved: true, targetPath: basenameMatches[0].path };
    } else if (basenameMatches.length > 1) {
      // Ambiguous match
      return {
        resolved: true,
        targetPath: basenameMatches[0].path,
        isAmbiguous: true,
        candidatePaths: basenameMatches.map((d) => d.path),
      };
    }

    // 4. Match note aliases anywhere in vault
    const aliasMatches = docs.filter((d) =>
      d.aliases.some((a) => a.toLowerCase() === targetBaseName)
    );

    if (aliasMatches.length === 1) {
      return { resolved: true, targetPath: aliasMatches[0].path };
    } else if (aliasMatches.length > 1) {
      return {
        resolved: true,
        targetPath: aliasMatches[0].path,
        isAmbiguous: true,
        candidatePaths: aliasMatches.map((d) => d.path),
      };
    }

    return { resolved: false };
  }
}

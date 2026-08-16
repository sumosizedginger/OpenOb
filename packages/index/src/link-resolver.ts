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
 * Follows Constitution Law 22: Single-resolver rule.
 */
export class DefaultLinkResolver implements LinkResolver {
  private pathMap: Map<string, ParsedDocument> | null = null;
  private basenameMap: Map<string, ParsedDocument[]> | null = null;
  private aliasMap: Map<string, ParsedDocument[]> | null = null;
  private lastDocs: ParsedDocument[] | null = null;

  constructor(private readonly getDocuments: () => ParsedDocument[]) {}

  private ensureIndex(docs: ParsedDocument[]): void {
    if (this.lastDocs === docs && this.pathMap) {
      return;
    }
    this.lastDocs = docs;
    this.pathMap = new Map<string, ParsedDocument>();
    this.basenameMap = new Map<string, ParsedDocument[]>();
    this.aliasMap = new Map<string, ParsedDocument[]>();

    for (const doc of docs) {
      this.pathMap.set(doc.path, doc);

      const base = basenameVaultPath(doc.path, '.md').toLowerCase();
      const existingBases = this.basenameMap.get(base);
      if (existingBases) {
        existingBases.push(doc);
      } else {
        this.basenameMap.set(base, [doc]);
      }

      for (const alias of doc.aliases) {
        const aliasLower = alias.toLowerCase();
        const existingAliases = this.aliasMap.get(aliasLower);
        if (existingAliases) {
          existingAliases.push(doc);
        } else {
          this.aliasMap.set(aliasLower, [doc]);
        }
      }
    }
  }

  resolve(sourcePath: VaultPath, rawTarget: string): LinkResolution {
    const target = rawTarget.trim();
    if (!target) {
      return { resolved: false };
    }

    // Strip subpath or alias if passed in rawTarget (e.g. "Note#Heading" or "Note|Alias")
    const cleanTarget = target.split('#')[0].split('|')[0].trim();
    if (!cleanTarget) {
      return { resolved: false };
    }

    const docs = this.getDocuments();
    this.ensureIndex(docs);
    const sourceDir = dirnameVaultPath(sourcePath);

    // 1. Exact relative path from source document's directory
    if (sourceDir) {
      const relPathWithExt = joinVaultPath(
        sourceDir,
        cleanTarget.endsWith('.md') ? cleanTarget : `${cleanTarget}.md`
      );
      const match = this.pathMap!.get(relPathWithExt);
      if (match) {
        return { resolved: true, targetPath: match.path };
      }
    }

    // 2. Exact path from vault root
    const rootPathWithExt = normalizeVaultPath(
      cleanTarget.endsWith('.md') ? cleanTarget : `${cleanTarget}.md`
    );
    const rootMatch = this.pathMap!.get(rootPathWithExt);
    if (rootMatch) {
      return { resolved: true, targetPath: rootMatch.path };
    }

    // 3. Match basename anywhere in vault
    const targetBaseName = cleanTarget.replace(/\.md$/i, '').toLowerCase();
    const basenameMatches = this.basenameMap!.get(targetBaseName) || [];

    if (basenameMatches.length === 1) {
      return { resolved: true, targetPath: basenameMatches[0].path };
    } else if (basenameMatches.length > 1) {
      return {
        resolved: true,
        targetPath: basenameMatches[0].path,
        isAmbiguous: true,
        candidatePaths: basenameMatches.map((d) => d.path),
      };
    }

    // 4. Match alias
    const aliasMatches = this.aliasMap!.get(cleanTarget.toLowerCase()) || [];

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

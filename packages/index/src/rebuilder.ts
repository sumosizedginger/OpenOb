import { DocumentIndex, DocumentParser, isReservedWorkspacePath, VaultStorage } from '@okw/core';
import { DefaultDocumentParser } from '@okw/markdown';

export interface RebuildProgress {
  totalFiles: number;
  processedFiles: number;
  currentPath: string;
}

export type RebuildProgressListener = (progress: RebuildProgress) => void;

/**
 * Rebuilds the derived document index completely from the canonical files in a VaultStorage.
 * Proves Constitution Law 2 & D-002: Derived indexes are 100% disposable and rebuildable.
 */
export async function rebuildVaultIndex(
  storage: VaultStorage,
  index: DocumentIndex,
  parser: DocumentParser = new DefaultDocumentParser(),
  onProgress?: RebuildProgressListener
): Promise<{ totalIndexed: number; elapsedMs: number }> {
  const startTime = Date.now();
  const allEntries = await storage.list('', true);
  const markdownEntries = allEntries.filter(
    (e) =>
      !e.isDirectory &&
      (e.path.endsWith('.md') || e.path.endsWith('.markdown')) &&
      !isReservedWorkspacePath(e.path)
  );

  const parsedDocs = [];
  let processed = 0;

  for (const entry of markdownEntries) {
    onProgress?.({
      totalFiles: markdownEntries.length,
      processedFiles: processed,
      currentPath: entry.path,
    });

    try {
      const snapshot = await storage.read(entry.path);
      const parsed = await parser.parse(entry.path, snapshot.content, snapshot.version.hash);
      parsedDocs.push({
        ...parsed,
        modifiedAt: snapshot.version.modifiedAt,
        size: snapshot.version.size,
      });
    } catch (err) {
      console.warn(`Failed to parse file during rebuild: "${entry.path}"`, err);
    }
    processed++;
  }

  await index.rebuild(parsedDocs);

  return {
    totalIndexed: parsedDocs.length,
    elapsedMs: Date.now() - startTime,
  };
}

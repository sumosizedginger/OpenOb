import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  Backlink,
  basenameVaultPath,
  dirnameVaultPath,
  DocumentIndex,
  joinVaultPath,
  LinkResolution,
  normalizeVaultPath,
  ParsedDocument,
  SearchRequest,
  SearchResult,
  VaultPath,
} from '@okw/core';

let SQL_PROMISE: Promise<SqlJsStatic> | null = null;

export async function getSqlJs(): Promise<SqlJsStatic> {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs();
  }
  return SQL_PROMISE;
}

export const SQLITE_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  hash TEXT NOT NULL,
  modified_at INTEGER NOT NULL,
  size INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_doc_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT,
  raw_target TEXT NOT NULL,
  display_text TEXT,
  line INTEGER NOT NULL,
  is_embed INTEGER NOT NULL,
  FOREIGN KEY (source_doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS headings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  slug TEXT NOT NULL,
  line INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  doc_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (doc_id, tag),
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS properties (
  doc_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (doc_id, key),
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS aliases (
  doc_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (doc_id, alias),
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);
CREATE INDEX IF NOT EXISTS idx_links_raw ON links(raw_target);
CREATE INDEX IF NOT EXISTS idx_headings_doc ON headings(doc_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);
CREATE INDEX IF NOT EXISTS idx_docs_path ON documents(path);
`;

/**
 * SQLite-backed implementation of DocumentIndex & SearchEngine.
 * 100% disposable and rebuildable from canonical markdown files (D-002, D-013).
 */
export class SqliteDocumentIndex implements DocumentIndex {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
    this.db.run(SQLITE_SCHEMA);
  }

  /**
   * Initializes a new SQLite document index instance.
   */
  static async create(existingData?: Uint8Array): Promise<SqliteDocumentIndex> {
    const SQL = await getSqlJs();
    const db = existingData ? new SQL.Database(existingData) : new SQL.Database();
    return new SqliteDocumentIndex(db);
  }

  /**
   * Exports the database bytes for persistence if needed.
   */
  export(): Uint8Array {
    return this.db.export();
  }

  /**
   * Closes the database.
   */
  close(): void {
    this.db.close();
  }

  private safeBind(stmt: any, params: any[]): void {
    const safeParams = params.map((p) => (p === undefined ? null : p));
    stmt.bind(safeParams);
  }

  private safeRun(sql: string, params: any[] = []): void {
    const safeParams = params.map((p) => (p === undefined ? null : p));
    this.db.run(sql, safeParams);
  }

  async upsert(doc: ParsedDocument): Promise<void> {
    const hash = doc.sourceHash || (doc as any).hash || '';
    const modifiedAt = (doc as any).modifiedAt ?? Date.now();
    const size = (doc as any).size ?? doc.textContent.length;
    const lineCount = doc.lineCount ?? doc.textContent.split(/\r?\n/).length;

    this.db.run('BEGIN TRANSACTION');
    try {
      // 1. Delete existing document records
      this.safeRun('DELETE FROM links WHERE source_doc_id = ?', [doc.id]);
      this.safeRun('DELETE FROM headings WHERE doc_id = ?', [doc.id]);
      this.safeRun('DELETE FROM tags WHERE doc_id = ?', [doc.id]);
      this.safeRun('DELETE FROM properties WHERE doc_id = ?', [doc.id]);
      this.safeRun('DELETE FROM aliases WHERE doc_id = ?', [doc.id]);
      this.safeRun('DELETE FROM documents WHERE id = ? OR path = ?', [doc.id, doc.path]);

      // 2. Insert document record
      this.safeRun(
        `INSERT INTO documents (id, path, title, hash, modified_at, size, word_count, line_count, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          doc.id,
          doc.path,
          doc.title,
          hash,
          modifiedAt,
          size,
          doc.wordCount,
          lineCount,
          doc.textContent,
        ]
      );

      // 3. Insert links
      for (const link of doc.links) {
        const rawTarget = link.target || (link as any).rawTarget || link.raw;
        const targetPath = (link as any).targetPath ?? null;
        this.safeRun(
          `INSERT INTO links (source_doc_id, source_path, target_path, raw_target, display_text, line, is_embed)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            doc.id,
            doc.path,
            targetPath,
            rawTarget,
            link.displayText ?? null,
            link.line,
            link.isEmbed ? 1 : 0,
          ]
        );
      }

      // 4. Insert headings
      for (const heading of doc.headings) {
        this.safeRun(
          `INSERT INTO headings (doc_id, level, text, slug, line)
           VALUES (?, ?, ?, ?, ?)`,
          [doc.id, heading.level, heading.text, heading.slug, heading.line]
        );
      }

      // 5. Insert tags
      for (const tag of doc.tags) {
        this.safeRun(`INSERT OR IGNORE INTO tags (doc_id, tag) VALUES (?, ?)`, [doc.id, tag]);
      }

      // 6. Insert properties & aliases
      if (doc.properties) {
        for (const [key, val] of Object.entries(doc.properties)) {
          this.safeRun(
            `INSERT OR REPLACE INTO properties (doc_id, key, value_json) VALUES (?, ?, ?)`,
            [doc.id, key, JSON.stringify(val)]
          );
        }
      }

      if (doc.aliases) {
        for (const alias of doc.aliases) {
          this.safeRun(`INSERT OR IGNORE INTO aliases (doc_id, alias) VALUES (?, ?)`, [doc.id, alias]);
        }
      }

      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  async remove(documentId: string): Promise<void> {
    this.db.run('BEGIN TRANSACTION');
    try {
      this.safeRun('DELETE FROM links WHERE source_doc_id = ?', [documentId]);
      this.safeRun('DELETE FROM headings WHERE doc_id = ?', [documentId]);
      this.safeRun('DELETE FROM tags WHERE doc_id = ?', [documentId]);
      this.safeRun('DELETE FROM properties WHERE doc_id = ?', [documentId]);
      this.safeRun('DELETE FROM aliases WHERE doc_id = ?', [documentId]);
      this.safeRun('DELETE FROM documents WHERE id = ?', [documentId]);
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  async rebuild(docs: AsyncIterable<ParsedDocument> | ParsedDocument[]): Promise<void> {
    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run('DELETE FROM links');
      this.db.run('DELETE FROM headings');
      this.db.run('DELETE FROM tags');
      this.db.run('DELETE FROM properties');
      this.db.run('DELETE FROM aliases');
      this.db.run('DELETE FROM documents');

      for await (const doc of docs) {
        const hash = doc.sourceHash || (doc as any).hash || '';
        const modifiedAt = (doc as any).modifiedAt ?? Date.now();
        const size = (doc as any).size ?? doc.textContent.length;
        const lineCount = doc.lineCount ?? doc.textContent.split(/\r?\n/).length;

        this.safeRun(
          `INSERT INTO documents (id, path, title, hash, modified_at, size, word_count, line_count, body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            doc.id,
            doc.path,
            doc.title,
            hash,
            modifiedAt,
            size,
            doc.wordCount,
            lineCount,
            doc.textContent,
          ]
        );

        for (const link of doc.links) {
          const rawTarget = link.target || (link as any).rawTarget || link.raw;
          const targetPath = (link as any).targetPath ?? null;
          this.safeRun(
            `INSERT INTO links (source_doc_id, source_path, target_path, raw_target, display_text, line, is_embed)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              doc.id,
              doc.path,
              targetPath,
              rawTarget,
              link.displayText ?? null,
              link.line,
              link.isEmbed ? 1 : 0,
            ]
          );
        }

        for (const heading of doc.headings) {
          this.safeRun(
            `INSERT INTO headings (doc_id, level, text, slug, line)
             VALUES (?, ?, ?, ?, ?)`,
            [doc.id, heading.level, heading.text, heading.slug, heading.line]
          );
        }

        for (const tag of doc.tags) {
          this.safeRun(`INSERT OR IGNORE INTO tags (doc_id, tag) VALUES (?, ?)`, [doc.id, tag]);
        }

        if (doc.properties) {
          for (const [key, val] of Object.entries(doc.properties)) {
            this.safeRun(
              `INSERT OR REPLACE INTO properties (doc_id, key, value_json) VALUES (?, ?, ?)`,
              [doc.id, key, JSON.stringify(val)]
            );
          }
        }

        if (doc.aliases) {
          for (const alias of doc.aliases) {
            this.safeRun(`INSERT OR IGNORE INTO aliases (doc_id, alias) VALUES (?, ?)`, [doc.id, alias]);
          }
        }
      }

      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  async get(documentId: string): Promise<ParsedDocument | null> {
    const stmt = this.db.prepare('SELECT * FROM documents WHERE id = ? OR path = ?');
    this.safeBind(stmt, [documentId, documentId]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject();
    stmt.free();

    return this.hydrateDocument(row);
  }

  async getAll(): Promise<ParsedDocument[]> {
    const res = this.db.exec('SELECT * FROM documents ORDER BY path ASC');
    if (res.length === 0) return [];

    const documents: ParsedDocument[] = [];
    for (const values of res[0].values) {
      const row: any = {};
      res[0].columns.forEach((col, idx) => {
        row[col] = values[idx];
      });
      documents.push(await this.hydrateDocument(row));
    }
    return documents;
  }

  private async hydrateDocument(row: any): Promise<ParsedDocument> {
    const docId = row.id as string;

    // Load links
    const linkStmt = this.db.prepare(
      'SELECT raw_target, target_path, display_text, line, is_embed FROM links WHERE source_doc_id = ? ORDER BY line ASC'
    );
    this.safeBind(linkStmt, [docId]);
    const links: any[] = [];
    while (linkStmt.step()) {
      const l = linkStmt.getAsObject();
      links.push({
        raw: `[[${l.raw_target}]]`,
        target: l.raw_target,
        rawTarget: l.raw_target,
        targetPath: l.target_path ?? undefined,
        displayText: l.display_text ?? undefined,
        line: l.line,
        isEmbed: Boolean(l.is_embed),
      });
    }
    linkStmt.free();

    // Load headings
    const headStmt = this.db.prepare(
      'SELECT level, text, slug, line FROM headings WHERE doc_id = ? ORDER BY line ASC'
    );
    this.safeBind(headStmt, [docId]);
    const headings: any[] = [];
    while (headStmt.step()) {
      const h = headStmt.getAsObject();
      headings.push({
        level: h.level,
        text: h.text,
        slug: h.slug,
        line: h.line,
      });
    }
    headStmt.free();

    // Load tags
    const tagStmt = this.db.prepare('SELECT tag FROM tags WHERE doc_id = ?');
    this.safeBind(tagStmt, [docId]);
    const tags: string[] = [];
    while (tagStmt.step()) {
      tags.push(tagStmt.getAsObject().tag as string);
    }
    tagStmt.free();

    // Load properties
    const propStmt = this.db.prepare('SELECT key, value_json FROM properties WHERE doc_id = ?');
    this.safeBind(propStmt, [docId]);
    const properties: Record<string, any> = {};
    while (propStmt.step()) {
      const p = propStmt.getAsObject();
      try {
        properties[p.key as string] = JSON.parse(p.value_json as string);
      } catch {}
    }
    propStmt.free();

    // Load aliases
    const aliasStmt = this.db.prepare('SELECT alias FROM aliases WHERE doc_id = ?');
    this.safeBind(aliasStmt, [docId]);
    const aliases: string[] = [];
    while (aliasStmt.step()) {
      aliases.push(aliasStmt.getAsObject().alias as string);
    }
    aliasStmt.free();

    return {
      id: row.id,
      path: row.path,
      title: row.title,
      sourceHash: row.hash,
      lineCount: row.line_count || 1,
      wordCount: row.word_count,
      properties,
      aliases,
      tags,
      headings,
      links,
      textContent: row.body,
    };
  }

  resolveLink(sourcePath: VaultPath, rawTarget: string): LinkResolution {
    const target = rawTarget.trim();
    if (!target) {
      return { resolved: false };
    }

    const sourceDir = dirnameVaultPath(sourcePath);

    // 1. Exact relative path from source document's directory
    if (sourceDir) {
      const relPathWithExt = joinVaultPath(sourceDir, target.endsWith('.md') ? target : `${target}.md`);
      const stmt1 = this.db.prepare('SELECT path FROM documents WHERE path = ?');
      this.safeBind(stmt1, [relPathWithExt]);
      if (stmt1.step()) {
        const p = stmt1.getAsObject().path as string;
        stmt1.free();
        return { resolved: true, targetPath: p };
      }
      stmt1.free();
    }

    // 2. Exact path from vault root
    const rootPathWithExt = normalizeVaultPath(target.endsWith('.md') ? target : `${target}.md`);
    const stmt2 = this.db.prepare('SELECT path FROM documents WHERE path = ?');
    this.safeBind(stmt2, [rootPathWithExt]);
    if (stmt2.step()) {
      const p = stmt2.getAsObject().path as string;
      stmt2.free();
      return { resolved: true, targetPath: p };
    }
    stmt2.free();

    // 3. Match basename anywhere in vault
    const targetBaseName = target.replace(/\.md$/i, '').toLowerCase();
    const res = this.db.exec('SELECT path FROM documents');
    const candidatePaths: string[] = [];

    if (res.length > 0) {
      for (const row of res[0].values) {
        const p = row[0] as string;
        const docBase = basenameVaultPath(p, '.md').toLowerCase();
        if (docBase === targetBaseName) {
          candidatePaths.push(p);
        }
      }
    }

    if (candidatePaths.length === 1) {
      return { resolved: true, targetPath: candidatePaths[0] };
    } else if (candidatePaths.length > 1) {
      return {
        resolved: true,
        targetPath: candidatePaths[0],
        isAmbiguous: true,
        candidatePaths,
      };
    }

    // 4. Match alias
    const aliasStmt = this.db.prepare(`
      SELECT d.path
      FROM aliases a
      JOIN documents d ON a.doc_id = d.id
      WHERE LOWER(a.alias) = LOWER(?)
    `);
    this.safeBind(aliasStmt, [target]);
    const aliasMatches: string[] = [];
    while (aliasStmt.step()) {
      aliasMatches.push(aliasStmt.getAsObject().path as string);
    }
    aliasStmt.free();

    if (aliasMatches.length === 1) {
      return { resolved: true, targetPath: aliasMatches[0] };
    } else if (aliasMatches.length > 1) {
      return {
        resolved: true,
        targetPath: aliasMatches[0],
        isAmbiguous: true,
        candidatePaths: aliasMatches,
      };
    }

    return { resolved: false };
  }

  async getBacklinks(documentPathOrId: string): Promise<Backlink[]> {
    const targetDoc = await this.get(documentPathOrId);
    const targetPath = targetDoc ? targetDoc.path : documentPathOrId;

    const backlinks: Backlink[] = [];

    const allLinksStmt = this.db.prepare(`
      SELECT l.source_doc_id, l.source_path, l.raw_target, l.line, d.title, d.body
      FROM links l
      JOIN documents d ON l.source_doc_id = d.id
    `);

    while (allLinksStmt.step()) {
      const row = allLinksStmt.getAsObject();
      const sourcePath = row.source_path as string;
      const rawTarget = row.raw_target as string;

      const resolution = this.resolveLink(sourcePath, rawTarget);
      if (resolution.resolved && resolution.targetPath === targetPath) {
        const body = (row.body as string) || '';
        const lines = body.split(/\r?\n/);
        const lineIdx = (row.line as number) - 1;
        const excerpt = lineIdx >= 0 && lineIdx < lines.length ? lines[lineIdx].trim() : undefined;

        backlinks.push({
          sourceDocumentId: row.source_doc_id as string,
          sourcePath,
          sourceTitle: (row.title as string) || sourcePath,
          rawLink: rawTarget,
          line: row.line as number,
          excerpt,
        });
      }
    }
    allLinksStmt.free();

    return backlinks;
  }

  async getOutgoingLinks(documentId: string): Promise<ParsedDocument[]> {
    const doc = await this.get(documentId);
    if (!doc) return [];

    const outgoing: ParsedDocument[] = [];
    const seenPaths = new Set<string>();

    for (const link of doc.links) {
      const raw = link.target || (link as any).rawTarget || link.raw;
      const res = this.resolveLink(doc.path, raw);
      if (res.resolved && res.targetPath && !seenPaths.has(res.targetPath)) {
        seenPaths.add(res.targetPath);
        const targetDoc = await this.get(res.targetPath);
        if (targetDoc) {
          outgoing.push(targetDoc);
        }
      }
    }

    return outgoing;
  }

  async query(request: SearchRequest): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryLower = request.query.toLowerCase().trim();
    if (!queryLower) return [];

    // Query SQLite documents table
    const stmt = this.db.prepare('SELECT id, path, title, body FROM documents');

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const id = row.id as string;
      const path = row.path as string;
      const title = row.title as string;
      const body = (row.body as string) || '';

      // Load tags for this document
      const tagStmt = this.db.prepare('SELECT tag FROM tags WHERE doc_id = ?');
      this.safeBind(tagStmt, [id]);
      const docTags: string[] = [];
      while (tagStmt.step()) {
        docTags.push(tagStmt.getAsObject().tag as string);
      }
      tagStmt.free();

      // Load aliases for this document
      const aliasStmt = this.db.prepare('SELECT alias FROM aliases WHERE doc_id = ?');
      this.safeBind(aliasStmt, [id]);
      const docAliases: string[] = [];
      while (aliasStmt.step()) {
        docAliases.push(aliasStmt.getAsObject().alias as string);
      }
      aliasStmt.free();

      // Scope folder filter
      if (request.scope?.folders && request.scope.folders.length > 0) {
        const inFolder = request.scope.folders.some((f) => {
          const normF = f.replace(/\/+$/, '');
          return path === normF || path.startsWith(`${normF}/`);
        });
        if (!inFolder) continue;
      }

      // Scope tag filter
      if (request.scope?.tags && request.scope.tags.length > 0) {
        const hasTag = request.scope.tags.some((t) =>
          docTags.some((dt) => dt.toLowerCase() === t.toLowerCase())
        );
        if (!hasTag) continue;
      }

      const titleLower = title.toLowerCase();
      const pathLower = path.toLowerCase();
      const bodyLower = body.toLowerCase();

      let score = 0;
      let excerpt: string | undefined;

      if (pathLower === queryLower || titleLower === queryLower) {
        score = 100;
      } else if (titleLower.includes(queryLower)) {
        score = 75;
      } else if (docAliases.some((a) => a.toLowerCase().includes(queryLower))) {
        score = 60;
      } else if (docTags.some((t) => t.toLowerCase().includes(queryLower))) {
        score = 50;
      } else if (bodyLower.includes(queryLower)) {
        score = 30;
        const idx = bodyLower.indexOf(queryLower);
        const start = Math.max(0, idx - 40);
        const end = Math.min(body.length, idx + queryLower.length + 60);
        excerpt = (start > 0 ? '...' : '') + body.slice(start, end).trim() + (end < body.length ? '...' : '');
      }

      if (score > 0) {
        results.push({
          documentId: id,
          path,
          title,
          excerpt,
          score,
          source: 'fts',
        });
      }
    }
    stmt.free();

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, request.limit ?? 50);
  }
}

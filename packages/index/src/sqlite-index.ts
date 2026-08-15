import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  Backlink,
  dirnameVaultPath,
  DocumentIndex,
  joinVaultPath,
  LinkResolution,
  normalizeVaultPath,
  ParsedDocument,
  ParsedHeading,
  ParsedLink,
  SearchRequest,
  SearchResult,
  VaultPath,
} from '@okw/core';
import { DefaultLinkResolver } from './link-resolver.js';

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
  target_name TEXT NOT NULL,
  raw TEXT NOT NULL,
  display_text TEXT,
  subpath TEXT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  tag TEXT NOT NULL,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);
CREATE INDEX IF NOT EXISTS idx_links_target_path ON links(target_path);
CREATE INDEX IF NOT EXISTS idx_links_target_name ON links(target_name);
CREATE INDEX IF NOT EXISTS idx_headings_doc ON headings(doc_id);
CREATE INDEX IF NOT EXISTS idx_tags_doc ON tags(doc_id);
CREATE INDEX IF NOT EXISTS idx_aliases_doc ON aliases(doc_id);
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

  export(): Uint8Array {
    return this.db.export();
  }

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

  private refreshLinkTargets(allDocs: ParsedDocument[]): void {
    const resolver = new DefaultLinkResolver(() => allDocs);
    const updateStmt = this.db.prepare('UPDATE links SET target_path = ? WHERE id = ?');
    const linkRows = this.db.exec('SELECT id, source_path, target_name FROM links');
    if (linkRows.length > 0) {
      for (const val of linkRows[0].values) {
        const linkId = val[0] as number;
        const sourcePath = val[1] as string;
        const targetName = val[2] as string;
        const res = resolver.resolve(sourcePath, targetName);
        const targetPath = res.resolved && res.targetPath ? res.targetPath : null;
        updateStmt.run([targetPath, linkId]);
      }
    }
    updateStmt.free();
  }

  async upsert(doc: ParsedDocument): Promise<void> {
    const hash = doc.sourceHash || (doc as any).hash || '';
    const modifiedAt = (doc as any).modifiedAt ?? 0;
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

      // 3. Insert headings
      for (const heading of doc.headings) {
        this.safeRun(
          `INSERT INTO headings (doc_id, level, text, slug, line)
           VALUES (?, ?, ?, ?, ?)`,
          [doc.id, heading.level, heading.text, heading.slug, heading.line]
        );
      }

      // 4. Insert tags
      for (const tag of doc.tags) {
        this.safeRun(`INSERT INTO tags (doc_id, tag) VALUES (?, ?)`, [doc.id, tag]);
      }

      // 5. Insert properties & aliases
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
          this.safeRun(`INSERT INTO aliases (doc_id, alias) VALUES (?, ?)`, [doc.id, alias]);
        }
      }

      // 6. Insert links
      for (const link of doc.links) {
        const targetName = link.target || (link as any).rawTarget || link.raw;
        const raw = link.raw || `[[${targetName}]]`;

        this.safeRun(
          `INSERT INTO links (source_doc_id, source_path, target_path, target_name, raw, display_text, subpath, line, is_embed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            doc.id,
            doc.path,
            null,
            targetName,
            raw,
            link.displayText ?? null,
            link.subpath ?? null,
            link.line,
            link.isEmbed ? 1 : 0,
          ]
        );
      }

      // 7. Authoritative link re-resolution across whole vault (P4-3)
      const allDocs = await this.getAll();
      this.refreshLinkTargets(allDocs);

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
      this.safeRun('DELETE FROM documents WHERE id = ? OR path = ?', [documentId, documentId]);

      // Re-resolve remaining link targets across vault (P4-3)
      const allDocs = await this.getAll();
      this.refreshLinkTargets(allDocs);

      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  async rebuild(docs: AsyncIterable<ParsedDocument> | ParsedDocument[]): Promise<void> {
    this.db.run('BEGIN TRANSACTION');
    let insertDocStmt: any = null;
    let insertHeadingStmt: any = null;
    let insertTagStmt: any = null;
    let insertPropStmt: any = null;
    let insertAliasStmt: any = null;
    let insertLinkStmt: any = null;

    try {
      this.db.run('DELETE FROM links');
      this.db.run('DELETE FROM headings');
      this.db.run('DELETE FROM tags');
      this.db.run('DELETE FROM properties');
      this.db.run('DELETE FROM aliases');
      this.db.run('DELETE FROM documents');

      insertDocStmt = this.db.prepare(
        `INSERT INTO documents (id, path, title, hash, modified_at, size, word_count, line_count, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insertHeadingStmt = this.db.prepare(
        `INSERT INTO headings (doc_id, level, text, slug, line) VALUES (?, ?, ?, ?, ?)`
      );
      insertTagStmt = this.db.prepare(
        `INSERT INTO tags (doc_id, tag) VALUES (?, ?)`
      );
      insertPropStmt = this.db.prepare(
        `INSERT OR REPLACE INTO properties (doc_id, key, value_json) VALUES (?, ?, ?)`
      );
      insertAliasStmt = this.db.prepare(
        `INSERT INTO aliases (doc_id, alias) VALUES (?, ?)`
      );

      const allParsed: ParsedDocument[] = [];

      // Phase 1: Insert all documents, headings, tags, aliases
      for await (const doc of docs) {
        allParsed.push(doc);
        const hash = doc.sourceHash || (doc as any).hash || '';
        const modifiedAt = (doc as any).modifiedAt ?? 0;
        const size = (doc as any).size ?? doc.textContent.length;
        const lineCount = doc.lineCount ?? doc.textContent.split(/\r?\n/).length;

        insertDocStmt.run([
          doc.id,
          doc.path,
          doc.title,
          hash,
          modifiedAt,
          size,
          doc.wordCount,
          lineCount,
          doc.textContent,
        ]);

        for (const heading of doc.headings) {
          insertHeadingStmt.run([
            doc.id,
            heading.level,
            heading.text,
            heading.slug,
            heading.line,
          ]);
        }

        for (const tag of doc.tags) {
          insertTagStmt.run([doc.id, tag]);
        }

        if (doc.properties) {
          for (const [key, val] of Object.entries(doc.properties)) {
            insertPropStmt.run([doc.id, key, JSON.stringify(val)]);
          }
        }

        if (doc.aliases) {
          for (const alias of doc.aliases) {
            insertAliasStmt.run([doc.id, alias]);
          }
        }
      }

      insertDocStmt.free();
      insertHeadingStmt.free();
      insertTagStmt.free();
      insertPropStmt.free();
      insertAliasStmt.free();

      // Phase 2: Authoritative fast in-memory link resolution across batch (P3-6A)
      const resolver = new DefaultLinkResolver(() => allParsed);
      insertLinkStmt = this.db.prepare(
        `INSERT INTO links (source_doc_id, source_path, target_path, target_name, raw, display_text, subpath, line, is_embed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const doc of allParsed) {
        for (const link of doc.links) {
          const targetName = link.target || (link as any).rawTarget || link.raw;
          const raw = link.raw || `[[${targetName}]]`;
          const res = resolver.resolve(doc.path, targetName);
          const targetPath = res.resolved && res.targetPath ? res.targetPath : null;

          insertLinkStmt.run([
            doc.id,
            doc.path,
            targetPath,
            targetName,
            raw,
            link.displayText ?? null,
            link.subpath ?? null,
            link.line,
            link.isEmbed ? 1 : 0,
          ]);
        }
      }

      insertLinkStmt.free();
      this.db.run('COMMIT');
    } catch (err) {
      insertDocStmt?.free();
      insertHeadingStmt?.free();
      insertTagStmt?.free();
      insertPropStmt?.free();
      insertAliasStmt?.free();
      insertLinkStmt?.free();
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

    // Load links (P3-1: preserve raw and subpath cleanly)
    const linkStmt = this.db.prepare(
      'SELECT raw, target_name, target_path, display_text, subpath, line, is_embed FROM links WHERE source_doc_id = ? ORDER BY line ASC'
    );
    this.safeBind(linkStmt, [docId]);
    const links: ParsedLink[] = [];
    while (linkStmt.step()) {
      const l = linkStmt.getAsObject();
      const linkObj: any = {
        raw: l.raw as string,
        target: l.target_name as string,
        line: l.line as number,
        isEmbed: Boolean(l.is_embed),
      };
      if (l.display_text) linkObj.displayText = l.display_text as string;
      if (l.subpath) linkObj.subpath = l.subpath as string;
      links.push(linkObj);
    }
    linkStmt.free();

    // Load headings
    const headStmt = this.db.prepare(
      'SELECT level, text, slug, line FROM headings WHERE doc_id = ? ORDER BY line ASC'
    );
    this.safeBind(headStmt, [docId]);
    const headings: ParsedHeading[] = [];
    while (headStmt.step()) {
      const h = headStmt.getAsObject();
      headings.push({
        level: h.level as number,
        text: h.text as string,
        slug: h.slug as string,
        line: h.line as number,
      });
    }
    headStmt.free();

    // Load tags in original insertion order
    const tagStmt = this.db.prepare('SELECT tag FROM tags WHERE doc_id = ? ORDER BY id ASC');
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

    // Load aliases in original insertion order
    const aliasStmt = this.db.prepare('SELECT alias FROM aliases WHERE doc_id = ? ORDER BY id ASC');
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
      aliases,
      headings,
      links,
      tags,
      properties,
      textContent: row.body,
      sourceHash: row.hash,
      lineCount: row.line_count || 1,
      wordCount: row.word_count,
    };
  }

  resolveLink(sourcePath: VaultPath, rawTarget: string): LinkResolution {
    const target = rawTarget.trim();
    if (!target) return { resolved: false };

    const cleanTarget = target.split('#')[0].split('|')[0].trim();
    if (!cleanTarget) return { resolved: false };

    const targetWithExt = cleanTarget.endsWith('.md') ? cleanTarget : `${cleanTarget}.md`;

    // 1. Exact relative path from source directory
    const sourceDir = dirnameVaultPath(sourcePath);
    if (sourceDir) {
      const relPath = joinVaultPath(sourceDir, targetWithExt);
      const stmt1 = this.db.prepare('SELECT path FROM documents WHERE path = ?');
      this.safeBind(stmt1, [relPath]);
      if (stmt1.step()) {
        const p = stmt1.getAsObject().path as string;
        stmt1.free();
        return { resolved: true, targetPath: p };
      }
      stmt1.free();
    }

    // 2. Exact path from root
    const rootPath = normalizeVaultPath(targetWithExt);
    const stmt2 = this.db.prepare('SELECT path FROM documents WHERE path = ?');
    this.safeBind(stmt2, [rootPath]);
    if (stmt2.step()) {
      const p = stmt2.getAsObject().path as string;
      stmt2.free();
      return { resolved: true, targetPath: p };
    }
    stmt2.free();

    // 3. Match basename anywhere in vault using SQLite query
    const baseStmt = this.db.prepare(`
      SELECT path FROM documents
      WHERE LOWER(path) = LOWER(?)
         OR LOWER(path) LIKE LOWER('%/' || ?)
         OR LOWER(path) = LOWER(?)
         OR LOWER(path) LIKE LOWER('%/' || ?)
    `);
    this.safeBind(baseStmt, [targetWithExt, targetWithExt, cleanTarget, cleanTarget]);
    const candidatePaths: string[] = [];
    while (baseStmt.step()) {
      candidatePaths.push(baseStmt.getAsObject().path as string);
    }
    baseStmt.free();

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
    this.safeBind(aliasStmt, [cleanTarget]);
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
    const targetId = targetDoc ? targetDoc.id : documentPathOrId;

    const backlinks: Backlink[] = [];

    // Exact Relational Indexed Query on target_path (P3-6A & P3-6B)
    // Constitution Law 22: 100% authoritative resolution without false positives
    const stmt = this.db.prepare(`
      SELECT l.source_doc_id, l.source_path, l.target_name, l.raw, l.line, d.title, d.body
      FROM links l
      JOIN documents d ON l.source_doc_id = d.id
      WHERE l.source_doc_id != ?
        AND l.source_path != ?
        AND l.target_path = ?
      ORDER BY l.line ASC
    `);
    this.safeBind(stmt, [targetId, targetPath, targetPath]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const sourcePath = row.source_path as string;
      const targetName = row.target_name as string;
      const rawLink = (row.raw as string) || `[[${targetName}]]`;

      const body = (row.body as string) || '';
      const lines = body.split(/\r?\n/);
      const lineIdx = (row.line as number) - 1;
      const excerpt = lineIdx >= 0 && lineIdx < lines.length ? lines[lineIdx].trim() : undefined;

      backlinks.push({
        sourceDocumentId: row.source_doc_id as string,
        sourcePath,
        sourceTitle: (row.title as string) || sourcePath,
        rawLink,
        line: row.line as number,
        excerpt,
      });
    }
    stmt.free();

    return backlinks;
  }

  async getOutgoingLinks(documentId: string): Promise<ParsedDocument[]> {
    const doc = await this.get(documentId);
    if (!doc) return [];

    const outgoing: ParsedDocument[] = [];
    const seenPaths = new Set<string>();

    for (const link of doc.links) {
      const res = this.resolveLink(doc.path, link.target);
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
    const q = request.query.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResult[] = [];
    const tokens = q.split(/\s+/).filter(Boolean);

    // Fast direct query over documents table
    const stmt = this.db.prepare('SELECT id, path, title, body FROM documents');
    const tagStmt = this.db.prepare('SELECT tag FROM tags WHERE doc_id = ?');
    const aliasStmt = this.db.prepare('SELECT alias FROM aliases WHERE doc_id = ?');
    const headStmt = this.db.prepare('SELECT text FROM headings WHERE doc_id = ?');

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const id = row.id as string;
      const path = row.path as string;
      const title = row.title as string;
      const body = (row.body as string) || '';

      // Scope folder filter
      if (request.scope?.folders && request.scope.folders.length > 0) {
        const inScope = request.scope.folders.some((f) => {
          const normF = f.replace(/\/+$/, '');
          return path === normF || path.startsWith(`${normF}/`);
        });
        if (!inScope) continue;
      }

      // Check tag filter if scope requires it
      if (request.scope?.tags && request.scope.tags.length > 0) {
        this.safeBind(tagStmt, [id]);
        let hasTag = false;
        while (tagStmt.step()) {
          const t = tagStmt.getAsObject().tag as string;
          if (request.scope.tags.includes(t)) {
            hasTag = true;
            break;
          }
        }
        tagStmt.reset();
        if (!hasTag) continue;
      }

      let score = 0;
      let source: SearchResult['source'] = 'fts';
      let excerpt: string | undefined;

      const titleLower = title.toLowerCase();
      const pathLower = path.toLowerCase();
      const bodyLower = body.toLowerCase();

      // 1. Exact or prefix title / navigation match
      if (titleLower === q || pathLower === q) {
        score += 100;
        source = 'navigation';
      } else if (titleLower.startsWith(q) || pathLower.startsWith(q)) {
        score += 70;
        source = 'navigation';
      } else if (titleLower.includes(q)) {
        score += 50;
        source = 'navigation';
      }

      // 2. Alias match (check only if query might match)
      this.safeBind(aliasStmt, [id]);
      while (aliasStmt.step()) {
        const alias = (aliasStmt.getAsObject().alias as string).toLowerCase();
        if (alias.includes(q)) {
          score += 40;
          break;
        }
      }
      aliasStmt.reset();

      // 3. Tag match
      this.safeBind(tagStmt, [id]);
      while (tagStmt.step()) {
        const tag = (tagStmt.getAsObject().tag as string).toLowerCase();
        if (tag.includes(q)) {
          score += 30;
          source = 'property';
          break;
        }
      }
      tagStmt.reset();

      // 4. Heading match (headings are inside body text, so only check if body contains q)
      if (bodyLower.includes(q)) {
        this.safeBind(headStmt, [id]);
        while (headStmt.step()) {
          const hText = headStmt.getAsObject().text as string;
          if (hText.toLowerCase().includes(q)) {
            score += 20;
            if (!excerpt) excerpt = `## ${hText}`;
            break;
          }
        }
        headStmt.reset();
      }

      // 5. Full text body match
      let bodyMatches = 0;
      for (const token of tokens) {
        const idx = bodyLower.indexOf(token);
        if (idx !== -1) {
          bodyMatches++;
          if (!excerpt) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(body.length, idx + token.length + 60);
            excerpt = (start > 0 ? '...' : '') + body.slice(start, end).trim() + '...';
          }
        }
      }

      if (bodyMatches === tokens.length) {
        score += 15 + bodyMatches * 2;
      } else if (bodyMatches > 0) {
        score += bodyMatches * 2;
      }

      if (score > 0) {
        results.push({
          documentId: id,
          path,
          title,
          excerpt,
          score,
          source,
        });
      }
    }

    stmt.free();
    tagStmt.free();
    aliasStmt.free();
    headStmt.free();

    return results
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, request.limit ?? 50);
  }
}

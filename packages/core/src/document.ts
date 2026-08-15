import { VaultPath } from './types.js';

export interface ParsedHeading {
  readonly level: number; // 1 to 6
  readonly text: string;
  readonly slug: string;
  readonly line: number;
}

export interface ParsedLink {
  readonly raw: string; // e.g. "[[Target Note|Alias#Heading]]"
  readonly target: string; // e.g. "Target Note"
  readonly displayText?: string; // e.g. "Alias"
  readonly subpath?: string; // e.g. "#Heading" or "^blockid"
  readonly isEmbed: boolean; // true for "![[Image.png]]"
  readonly line: number;
}

export interface ParsedTag {
  readonly tag: string; // e.g. "#project/subtask"
  readonly line: number;
}

export interface ParsedDocument {
  readonly id: string; // Document ID (usually normalized relative path)
  readonly path: VaultPath;
  readonly title: string;
  readonly aliases: string[];
  readonly headings: ParsedHeading[];
  readonly links: ParsedLink[];
  readonly tags: string[];
  readonly properties: Record<string, unknown>;
  readonly textContent: string;
  readonly sourceHash: string;
  readonly lineCount: number;
  readonly wordCount: number;
}

export interface DocumentParser {
  parse(path: VaultPath, content: string | Uint8Array, sourceHash?: string): Promise<ParsedDocument>;
}

import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../frontmatter.js';
import { DefaultDocumentParser } from '../parser.js';
import { extractWikilinks } from '../wikilinks.js';

describe('Markdown Parser & Wikilinks', () => {
  const sampleMarkdown = `---
title: Quantum Computing Notes
aliases:
  - QC Notes
  - Quantum Overview
tags:
  - physics/quantum
  - computing
status: active
---

# Quantum Computing Overview

This is an introduction to quantum systems. See [[Linear Algebra#Eigenvalues|Math Foundations]] and [[Qubits]].
Also refer to ![[bloch_sphere.png]].

## Key Principles

- Superposition
- Entanglement (#quantum/entangled)
- Interference

Check [[Algorithms#Shor's Algorithm]] for details.
`;

  it('parses frontmatter correctly', () => {
    const { properties, hasFrontmatter } = parseFrontmatter(sampleMarkdown);
    expect(hasFrontmatter).toBe(true);
    expect(properties.title).toBe('Quantum Computing Notes');
    expect(properties.aliases).toEqual(['QC Notes', 'Quantum Overview']);
    expect(properties.tags).toEqual(['physics/quantum', 'computing']);
    expect(properties.status).toBe('active');
  });

  it('extracts wikilinks with targets, aliases, subpaths, and embeds', () => {
    const links = extractWikilinks(sampleMarkdown);
    expect(links).toHaveLength(4);

    expect(links[0]).toMatchObject({
      target: 'Linear Algebra',
      displayText: 'Math Foundations',
      subpath: '#Eigenvalues',
      isEmbed: false,
    });

    expect(links[1]).toMatchObject({
      target: 'Qubits',
      displayText: undefined,
      subpath: undefined,
      isEmbed: false,
    });

    expect(links[2]).toMatchObject({
      target: 'bloch_sphere.png',
      isEmbed: true,
    });

    expect(links[3]).toMatchObject({
      target: 'Algorithms',
      subpath: "#Shor's Algorithm",
      isEmbed: false,
    });
  });

  it('parses full document structure', async () => {
    const parser = new DefaultDocumentParser();
    const doc = await parser.parse('science/quantum.md', sampleMarkdown);

    expect(doc.id).toBe('science/quantum.md');
    expect(doc.title).toBe('Quantum Computing Notes');
    expect(doc.aliases).toEqual(['QC Notes', 'Quantum Overview']);
    expect(doc.headings).toHaveLength(2);
    expect(doc.headings[0].text).toBe('Quantum Computing Overview');
    expect(doc.headings[0].level).toBe(1);
    expect(doc.headings[1].text).toBe('Key Principles');
    expect(doc.headings[1].level).toBe(2);

    expect(doc.tags).toContain('physics/quantum');
    expect(doc.tags).toContain('computing');
    expect(doc.tags).toContain('quantum/entangled');
    expect(doc.wordCount).toBeGreaterThan(30);
  });
});

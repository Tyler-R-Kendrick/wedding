import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RUBRIC = path.join(process.cwd(), 'docs/design/multi-contact-guests-rubric.md');
const TESTS_ROOT = path.join(process.cwd(), 'tests');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    if (/\.(ts|tsx)$/.test(name)) return [p];
    return [];
  });
}

function rowIdsFromRubric(): string[] {
  const text = readFileSync(RUBRIC, 'utf8');
  const matches = [...text.matchAll(/\|\s*([CEOPTSAUX]-\d{2})\s*\|/g)];
  return [...new Set(matches.map((m) => m[1]).filter((id): id is string => id != null))].sort();
}

function vitestNamesFromFile(content: string): string[] {
  const names: string[] = [];
  const re = /\b(?:it|describe)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*['`]([^'`]+)['`]/g;
  for (const m of content.matchAll(re)) if (m[1]) names.push(m[1]);
  return names;
}

function allVitestNames(): string[] {
  return walk(TESTS_ROOT).flatMap((file) => vitestNamesFromFile(readFileSync(file, 'utf8')));
}

describe('multi-contact guests rubric matrix', () => {
  it('lists every row ID from docs/design/multi-contact-guests-rubric.md', () => {
    const ids = rowIdsFromRubric();
    expect(ids.length).toBeGreaterThanOrEqual(84);
    expect(ids).toContain('U-08');
    expect(ids).toContain('C-12');
    expect(ids).toContain('C-01');
    expect(ids).toContain('U-07');
  });

  it('C-01 through U-07: each row ID appears in at least one vitest name under tests/', () => {
    const ids = rowIdsFromRubric();
    const corpus = allVitestNames().join('\n');
    const missing = ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(corpus));
    expect(missing, `missing rubric row IDs in test names: ${missing.join(', ')}`).toEqual([]);
  });
});

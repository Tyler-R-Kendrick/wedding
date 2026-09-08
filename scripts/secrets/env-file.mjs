#!/usr/bin/env node
/**
 * Reading, merging and writing `.env` — the one place that touches the file, so every
 * script (apply-env, autofill, acquire, verify) agrees on quoting and on the rule that
 * values are never printed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ASSIGN_RE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

/** Shell-safe rendering: bare when it cannot be misread, JSON-quoted otherwise. */
export function quote(value) {
  return /^[A-Za-z0-9_./:@+=,-]*$/.test(value) ? value : JSON.stringify(value);
}

/** Strip one layer of matching quotes, honouring escapes inside double quotes. */
function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1);
  // An unquoted value ends at the first ` #` comment.
  return s.replace(/\s+#.*$/, '').trim();
}

/**
 * Parse dotenv text into a Map. Tolerates `export`, comments, blank lines, CRLF,
 * and triple-or-double-quoted multi-line values (Vercel and Doppler both emit those).
 */
export function parseDotenv(text) {
  const out = new Map();
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = ASSIGN_RE.exec(line);
    if (!m) continue;
    let raw = m[2];
    // Multi-line double-quoted value: keep consuming until the closing quote.
    if (/^"/.test(raw.trim()) && !/^"(?:[^"\\]|\\.)*"\s*$/.test(raw.trim())) {
      const buf = [raw];
      while (++i < lines.length) {
        buf.push(lines[i]);
        if (/(^|[^\\])"\s*$/.test(lines[i])) break;
      }
      raw = buf.join('\n');
    }
    out.set(m[1], unquote(raw));
  }
  return out;
}

/** Names currently set to a non-empty value in `text`. */
export function presentNames(text) {
  const set = new Set();
  for (const [k, v] of parseDotenv(text)) if (v !== '' && v !== '""') set.add(k);
  return set;
}

export async function readEnv(path = '.env') {
  return existsSync(path) ? readFile(path, 'utf8') : '';
}

/**
 * Merge `entries` (Map name→value) into dotenv `text`, rewriting assignments in place
 * and appending the rest under a dated comment. Returns the new text plus the names
 * touched — never the values.
 */
export function mergeEnv(text, entries, { note = 'scripts/secrets' } = {}) {
  const lines = text ? text.split('\n') : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = ASSIGN_RE.exec(line);
    if (!m || !entries.has(m[1])) return line;
    seen.add(m[1]);
    return `${m[1]}=${quote(entries.get(m[1]))}`;
  });
  const added = [...entries.keys()].filter((k) => !seen.has(k));
  if (added.length) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(`# added by ${note} ${new Date().toISOString()}`);
    for (const k of added) out.push(`${k}=${quote(entries.get(k))}`);
  }
  return { text: out.join('\n').replace(/\n*$/, '\n'), updated: [...seen], added };
}

/** Merge and write, 0600. Returns { updated, added } — names only. */
export async function applyEnv(entries, { path = '.env', note = 'scripts/secrets', dryRun = false } = {}) {
  const existing = await readEnv(path);
  const result = mergeEnv(existing, entries, { note });
  if (!dryRun) await writeFile(path, result.text, { mode: 0o600 });
  return result;
}

/** `NAME (12 chars)` — the only shape in which a value may be described out loud. */
export function describe(entries) {
  return [...entries.entries()].map(([k, v]) => `${k} (${String(v).length} chars)`);
}

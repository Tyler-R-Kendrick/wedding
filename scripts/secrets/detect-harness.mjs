#!/usr/bin/env node
/**
 * Credentials you already have. If this machine is signed in to Claude Code, Codex, GitHub
 * Copilot, or is running Ollama, the concierge can borrow that session instead of asking
 * anyone for a new key — ambient auth, the cheapest rung on the whole ladder.
 *
 *   node scripts/secrets/detect-harness.mjs            # report what is signed in
 *   node scripts/secrets/detect-harness.mjs --apply    # wire the best one into .env
 *
 * What it will and will not do. Without `--apply` it only checks that a file exists and never
 * opens one. With `--apply` it opens a harness credential file for the single purpose of
 * copying a token into `.env`, which `.claude/settings.json` denies agents from reading.
 * Output is names, hosts and lengths — never a value.
 *
 * A borrowed session is for local development. It carries the harness operator's identity,
 * not the site's, so `verify.mjs` reports it as `ambient` and production still wants its own
 * key. Nothing here creates, elevates, or transmits a credential anywhere new.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyEnv, describe } from './env-file.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const envPath = (() => { const i = args.indexOf('--env'); return i >= 0 ? args[i + 1] : '.env'; })();
const home = homedir();
const at = (...parts) => join(home, ...parts);
const has = (...parts) => existsSync(at(...parts));

/**
 * Each harness: how to tell it is signed in without opening anything, and what the app needs
 * in order to use it. `wire` returns the variables to write, or null when the credential
 * turns out to be absent, expired, or not usable for inference.
 */
const HARNESSES = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    note: 'Anthropic OAuth session from the Claude Code CLI',
    detect: () => has('.claude', '.credentials.json'),
    // The file also holds unrelated MCP OAuth state, so its existence proves nothing. This
    // reads key names only — never a value — to say whether a session is actually in there.
    async verify() {
      const path = at('.claude', '.credentials.json');
      if (!existsSync(path)) return false;
      const raw = JSON.parse(await readFile(path, 'utf8'));
      const oauth = raw?.claudeAiOauth ?? raw;
      return typeof (oauth?.accessToken ?? oauth?.access_token) === 'string';
    },
    async wire() {
      const path = at('.claude', '.credentials.json');
      if (!existsSync(path)) return null;
      const raw = JSON.parse(await readFile(path, 'utf8'));
      // The shape has moved across versions; accept the ones seen in the wild.
      const oauth = raw?.claudeAiOauth ?? raw;
      const token = oauth?.accessToken ?? oauth?.access_token;
      if (!token) return null;
      const expiresAt = Number(oauth?.expiresAt ?? oauth?.expires_at ?? 0);
      if (expiresAt && expiresAt < Date.now()) return null;
      return {
        // An OAuth bearer goes in the auth-token slot, not the x-api-key one.
        ANTHROPIC_AUTH_TOKEN: token,
        ...(process.env.ANTHROPIC_BASE_URL ? { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL } : {}),
        AI_HARNESS: 'claude-code',
      };
    },
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    note: 'OpenAI OAuth session from the Codex CLI',
    detect: () => has('.codex', 'auth.json') || has('.config', 'codex', 'auth.json'),
    async wire() {
      const path = [at('.codex', 'auth.json'), at('.config', 'codex', 'auth.json')].find(existsSync);
      if (!path) return null;
      const raw = JSON.parse(await readFile(path, 'utf8'));
      const token = raw?.tokens?.access_token ?? raw?.OPENAI_API_KEY ?? raw?.access_token;
      if (!token) return null;
      return { OPENAI_API_KEY: token, AI_HARNESS: 'codex' };
    },
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    note: 'Copilot speaks the OpenAI API once its short-lived token is exchanged',
    detect: () => has('.config', 'github-copilot', 'apps.json') || has('.config', 'github-copilot', 'hosts.json'),
    async wire() {
      const path = [at('.config', 'github-copilot', 'apps.json'), at('.config', 'github-copilot', 'hosts.json')].find(existsSync);
      if (!path) return null;
      const raw = JSON.parse(await readFile(path, 'utf8'));
      // Both shapes nest the GitHub OAuth token one level down, keyed by host.
      const entry = Object.values(raw).find((v) => v && typeof v === 'object' && 'oauth_token' in v);
      const oauth = entry?.oauth_token;
      if (!oauth) return null;
      const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
        headers: { authorization: `token ${oauth}`, accept: 'application/json', 'user-agent': 'sara-tyler-wedding-site/0.1' },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      const json = res && res.ok ? await res.json().catch(() => null) : null;
      if (!json?.token) return null;
      return { OPENAI_API_KEY: json.token, AI_BASE_URL: 'https://api.githubcopilot.com', AI_HARNESS: 'copilot' };
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    note: 'A model server already running here; no credential at all',
    detect: () => !!process.env.OLLAMA_HOST || has('.ollama', 'id_ed25519'),
    async wire() {
      const raw = process.env.OLLAMA_HOST || 'http://localhost:11434';
      const url = (raw.startsWith('http') ? raw : `http://${raw}`).replace(/\/+$/, '');
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
      if (!res?.ok) return null;
      const tags = await res.json().catch(() => null);
      const model = tags?.models?.[0]?.name;
      if (!model) return null;
      return { OPENAI_API_KEY: 'ollama', AI_BASE_URL: `${url}/v1`, AI_CHAT_MODEL: model, AI_FAST_MODEL: model, AI_HARNESS: 'ollama' };
    },
  },
];

/** Which harnesses look signed in. Existence only — no credential file is opened here. */
export function detect() {
  const found = [];
  for (const h of HARNESSES) {
    try { if (h.detect()) found.push({ id: h.id, name: h.name, note: h.note }); } catch { /* unreadable home */ }
  }
  return found;
}

/**
 * Presence plus a key-names-only check of whether a session is really in there. A harness can
 * leave its config behind with no usable credential — this sandbox's Claude Code file holds
 * only MCP OAuth state — and reporting that as "signed in" would be a lie the user acts on.
 */
export async function inspect() {
  const out = [];
  for (const found of detect()) {
    const harness = HARNESSES.find((h) => h.id === found.id);
    let usable = null; // null = we did not look (no verifier)
    if (harness?.verify) {
      try { usable = await harness.verify(); } catch { usable = false; }
    }
    out.push({ ...found, usable });
  }
  return out;
}

/** Borrow the first harness that yields a usable credential. Returns what was written. */
export async function borrow({ path = '.env', only = null } = {}) {
  for (const { id } of detect()) {
    if (only && id !== only) continue;
    const harness = HARNESSES.find((h) => h.id === id);
    let values = null;
    try { values = await harness.wire(); } catch { values = null; }
    if (!values) continue;
    const entries = new Map(Object.entries(values));
    const result = await applyEnv(entries, { path, note: `scripts/secrets/detect-harness.mjs (${id})` });
    return { harness: harness.name, id, entries, ...result };
  }
  return null;
}

async function main() {
  const found = await inspect();
  if (!found.length) {
    console.log('No AI harness found here (looked for Claude Code, Codex, GitHub Copilot, Ollama).');
    return;
  }
  console.log('harness'.padEnd(13), 'session'.padEnd(22), 'what it is');
  for (const h of found) {
    const state = h.usable === true ? 'usable' : h.usable === false ? 'present, none in it' : 'present, unverified';
    console.log(`${h.id.padEnd(13)}${state.padEnd(22)}${h.note}`);
  }

  if (!apply) {
    const usable = found.filter((h) => h.usable !== false).length;
    console.log(`\nNo value was read. ${usable ? `Run with --apply to borrow one of the ${usable}.` : 'Nothing here holds a credential to borrow.'}`);
    return;
  }

  const borrowed = await borrow({ path: envPath, only: (() => { const i = args.indexOf('--harness'); return i >= 0 ? args[i + 1] : null; })() });
  if (!borrowed) {
    console.log('\nFound harnesses, but none held a usable credential.');
    process.exitCode = 1;
    return;
  }
  console.log(`\nBorrowed the ${borrowed.harness} session.`);
  for (const line of describe(borrowed.entries)) console.log(`  ${line}`);
  console.log(`  updated=[${borrowed.updated.join(', ')}] added=[${borrowed.added.join(', ')}]`);
  console.log("  This is the harness operator's identity, for local development. Production wants its own key.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

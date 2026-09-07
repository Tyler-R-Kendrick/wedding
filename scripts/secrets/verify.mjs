#!/usr/bin/env node
/**
 * Is what landed in .env actually good? Every credential in the registry that carries a
 * `probe` gets one cheap authenticated request; the answer is live / rejected / unreachable.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/secrets/verify.mjs [--json] [--credential resend]
 *
 * A key that is present but rejected is worse than a missing one — the app would take the
 * live path and fail in front of guests — so this is what turns a "set" chip on the Secret
 * Drop page into a "working" chip. Values are read, used once, and never printed.
 */
import { SLOTS, chosenOption } from './registry.mjs';
import { readEnv, parseDotenv } from './env-file.mjs';

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const only = opt('slot', null);
const envPath = opt('env', '.env');
const env = parseDotenv(await readEnv(envPath));
const value = (name) => (env.get(name) || process.env[name] || '').trim();

/** Fill {value} placeholders in a probe's headers/body with the real credential. */
function materialize(probe, secret) {
  const headers = {};
  for (const [k, v] of Object.entries(probe.headers || {})) headers[k] = String(v).replaceAll('{value}', secret);
  return { ...probe, headers };
}

async function probeOne(cred) {
  const varName = cred.probe.valueVar || cred.vars[0];
  const secret = value(varName);
  if (!secret) return { credential: cred.id, state: 'missing', vars: cred.vars, detail: `${varName} is not set` };
  const probe = materialize(cred.probe, secret);
  try {
    const res = await fetch(probe.url, {
      method: probe.method || 'GET',
      headers: { accept: 'application/json', ...probe.headers },
      body: probe.body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) return { credential: cred.id, state: 'rejected', vars: cred.vars, detail: `${varName} was refused (HTTP ${res.status}) — rotate it or re-run acquire` };
    if (res.status === 429) return { credential: cred.id, state: 'live', vars: cred.vars, detail: 'accepted (rate limited right now)' };
    if (res.ok) return { credential: cred.id, state: 'live', vars: cred.vars, detail: `accepted by ${new URL(probe.url).host}` };
    return { credential: cred.id, state: 'unclear', vars: cred.vars, detail: `HTTP ${res.status} from ${new URL(probe.url).host}` };
  } catch (err) {
    return { credential: cred.id, state: 'unreachable', vars: cred.vars, detail: err.message };
  }
}

// Probe the option each slot is actually set to, not every option that exists.
const choices = existsSync('.secrets/choices.json') ? JSON.parse(await readFile('.secrets/choices.json', 'utf8')) : {};
const active = SLOTS.filter((s) => !only || s.id === only)
  .map((slot) => { const option = chosenOption(slot, choices); return { id: slot.id, name: `${slot.name} (${option.name})`, vars: option.secrets, probe: option.probe }; });
const targets = active.filter((c) => c.probe);
const results = [];
for (const cred of targets) results.push(await probeOne(cred));

// Credentials without a probe still get a set/unset answer.
for (const cred of active.filter((c) => !c.probe)) {
  const set = cred.vars.filter((v) => value(v));
  results.push({
    credential: cred.id, vars: cred.vars,
    state: !cred.vars.length ? 'not needed' : set.length === cred.vars.length ? 'set' : set.length ? 'partial' : 'missing',
    detail: set.length === cred.vars.length ? 'no probe available — presence only' : `${set.length}/${cred.vars.length} variables set`,
  });
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
} else {
  console.log('credential'.padEnd(20), 'state'.padEnd(12), 'detail');
  for (const r of results) console.log(r.credential.padEnd(20), r.state.padEnd(12), r.detail);
}
process.exit(results.some((r) => r.state === 'rejected') ? 1 : 0);

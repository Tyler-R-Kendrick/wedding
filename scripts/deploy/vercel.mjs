#!/usr/bin/env node
/**
 * Deploy the site to Vercel, with Vercel's own connectors doing the provisioning.
 *
 *   npm run deploy:vercel            # preview deployment of the current checkout
 *   npm run deploy:vercel -- --prod  # production
 *   npm run deploy:vercel:plan       # say what would happen; write nothing
 *
 * The only credential this needs is the Vercel CLI session — acquired through the Secret Drop's
 * Hosting strip, which runs `vercel login` and streams the one link it prints (cli-login.mjs).
 * A `VERCEL_TOKEN` in the environment is honoured too, for CI. Nothing here prints a value: names
 * and lengths only, as everywhere else in scripts/secrets.
 *
 * What it does, in order, each step idempotent so it can be re-run after any of them:
 *
 *   1. Session      `vercel whoami`; without one, say where to get it and stop.
 *   2. Scope        the team, from --scope / VERCEL_SCOPE / .vercel/project.json / the only team.
 *   3. Project      find or create it, linked to the GitHub repo (`git remote origin`), Fluid
 *                   compute on, OIDC on (the AI Gateway and Vercel Connect both sign with it).
 *   4. Link         `vercel link` so the CLI's integration and deploy commands target it.
 *   5. Connectors   Marketplace integrations for the database and email: `vercel integration add`
 *                   provisions the resource AND injects its variables into the project. The app
 *                   reads the connector's names (POSTGRES_URL -> DATABASE_URL, src/lib/env.ts),
 *                   so no value is copied by hand and the connector stays the owner of it.
 *   6. Variables    the site's own secrets, generated here if the project lacks them; the public
 *                   origin; and what the Secret Drop already acquired into .env, mirrored as
 *                   sensitive variables — minus anything a connector now owns.
 *   7. Cron         vercel.json carries them (Vercel sends `Authorization: Bearer $CRON_SECRET`
 *                   itself). Nothing to do but read the file out.
 *   8. Preflight    every variable src/lib/env.ts requires in production is present, or stop. A
 *                   build goes READY whether or not the app can boot; the first run of this
 *                   script proved that by serving 500 on every route.
 *   9. Deploy       `vercel deploy` (or `--prod`), then wait for READY and read the build log if
 *                   it is not.
 *
 * Vercel Connect (the OIDC-to-provider-token exchange, `vercel connect create <service>`) is for
 * a third-party API the *running site* calls with its own identity — Slack, Notion, GitHub. No
 * feature here does that today; the connectors this site needs are the Marketplace ones above.
 * When one does, attach it with `vercel connect attach <connector>` and read the token with
 * `@vercel/connect`'s getToken — that package is not a dependency yet and packages are fixed.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '../secrets/env-file.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

const PLAN = flag('plan');
const PROD = flag('prod');
const PROJECT = opt('project', 'wedding');
const API = 'https://api.vercel.com';
const VERCEL_BIN = resolve(repoRoot, 'node_modules/.bin/vercel');

/** Marketplace connectors, and the variable each injects that tells us it is already there. */
const CONNECTORS = [
  { slug: 'supabase', name: `${PROJECT}-db`, slot: 'database', gives: ['POSTGRES_URL', 'DATABASE_URL'], owns: ['DATABASE_URL'] },
  { slug: 'resend', name: `${PROJECT}-email`, slot: 'email', gives: ['RESEND_API_KEY'], owns: ['RESEND_API_KEY'] },
];

/** Secrets the site needs in every deployed environment; generated here when the project has none. */
const GENERATED = [
  ['CONFIRMATION_SECRET', 32], ['CRON_SECRET', 48], ['BETTER_AUTH_SECRET', 32], ['HEALTH_TOKEN', 32], ['AUDIT_HASH_KEY', 32],
  // src/lib/env.ts refuses production without S3 or a signing secret, and a project this script
  // has just created has neither — so every fresh deploy it made could only ever 500. It is a
  // generated value like the five above, not something anyone has to go and find.
  ['STORAGE_SIGNING_SECRET', 32],
];

/**
 * Variables in .env that are the deployment's business. Everything else there is either local-only
 * (PGlite, the dev inbox, the test principal) or a build-machine tool key (FAL_KEY, STITCH,
 * OPENVERSE, the harness session) and must not travel.
 */
const MIRROR = [
  'RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAILS',
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE',
  'MEDIA_PART_SIZE_MB', 'MEDIA_MULTIPART_THRESHOLD_MB', 'STORAGE_SIGNING_SECRET',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AI_BASE_URL', 'AI_CHAT_MODEL', 'AI_FAST_MODEL', 'AI_GATEWAY', 'AI_GATEWAY_API_KEY',
  'VOYAGE_API_KEY', 'EMBEDDINGS_PROVIDER', 'NEXT_PUBLIC_AI_BROWSER_MODEL',
  'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'CLOUDFLARE_STREAM_ACCOUNT_ID', 'CLOUDFLARE_STREAM_API_TOKEN',
  'WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET',
  'RATE_LIMIT_BACKEND', 'TRUSTED_PROXY_HOPS',
];
const TARGETS = ['production', 'preview'];

const say = (...m) => console.log(...m);
const step = (title) => say(`\n== ${title}`);

/* ------------------------------------------------------------------ process helpers */

/** Run the Vercel CLI with an argv array (no shell), streaming as it goes; resolve with the text. */
function vercel(argv, { quiet = false, env = {} } = {}) {
  return new Promise((done) => {
    const child = spawn(VERCEL_BIN, [...argv, '--no-color'], {
      cwd: repoRoot, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, NODE_OPTIONS: '' },
    });
    let out = '';
    const take = (c) => { out += String(c); if (!quiet) process.stdout.write(String(c)); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => done({ code: 127, out: `${out}\n${e.message}` }));
    child.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

function git(argv) {
  return new Promise((done) => {
    const child = spawn('git', argv, { cwd: repoRoot, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += String(c); });
    child.on('error', () => done(''));
    child.on('close', () => done(out.trim()));
  });
}

/* ------------------------------------------------------------------ the session */

/**
 * The token, for the REST calls the CLI has no command for. VERCEL_TOKEN first; otherwise the file
 * `vercel login` wrote, which is also what `@vercel/oidc` reads. Never logged.
 */
async function token() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const dataDir = process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support')
    : process.platform === 'win32'
      ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'))
      : (process.env.XDG_DATA_HOME || join(homedir(), '.local/share'));
  const file = join(dataDir, 'com.vercel.cli', 'auth.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, 'utf8')).token || null; } catch { return null; }
}

let bearer = null;
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, json };
}

/* ------------------------------------------------------------------ steps */

async function ensureSession() {
  step('1. Session');
  const who = await vercel(['whoami'], { quiet: true });
  if (who.code !== 0) {
    say('No Vercel session on this machine.');
    say('Sign in through the Secret Drop\'s Hosting strip (it runs the CLI login and shows you the link),');
    say('or set VERCEL_TOKEN for a non-interactive run.');
    process.exit(1);
  }
  const user = who.out.trim().split('\n').filter(Boolean).pop();
  say(`Signed in as ${user}.`);
  bearer = await token();
  if (!bearer) {
    say('The CLI is signed in but its token file was not found; REST steps (project settings, variables) will be skipped.');
  }
}

async function resolveScope() {
  step('2. Scope');
  let scope = opt('scope', process.env.VERCEL_SCOPE);
  if (!scope && existsSync(join(repoRoot, '.vercel/project.json'))) {
    try { scope = JSON.parse(await readFile(join(repoRoot, '.vercel/project.json'), 'utf8')).orgId; } catch { /* re-link */ }
  }
  if (!scope && bearer) {
    const teams = await api('GET', '/v2/teams?limit=20');
    const list = teams.json?.teams || [];
    if (list.length === 1) scope = list[0].id;
    else if (list.length > 1) {
      say('More than one team; pass --scope <team id or slug>:');
      for (const t of list) say(`  ${t.id}  ${t.slug}`);
      process.exit(1);
    }
  }
  if (!scope) { say('No team could be determined; pass --scope <team id or slug>.'); process.exit(1); }
  say(`Team: ${scope}`);
  return scope;
}

async function repoSlug() {
  const url = await git(['remote', 'get-url', 'origin']);
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function ensureProject(scope) {
  step('3. Project');
  const q = `?teamId=${encodeURIComponent(scope)}`;
  const repo = await repoSlug();
  if (!bearer) { say(`(no token: assuming "${PROJECT}" exists or that \`vercel link\` below will create it)`); return null; }
  const existing = await api('GET', `/v9/projects/${encodeURIComponent(PROJECT)}${q}`);
  let project = existing.ok ? existing.json : null;
  if (project) {
    say(`"${PROJECT}" exists (${project.id})${project.link ? `, linked to ${project.link.org}/${project.link.repo}` : ', not linked to a repository'}.`);
  } else if (PLAN) {
    say(`Would create "${PROJECT}" linked to ${repo || '(no GitHub remote found)'}, Fluid compute on, OIDC on.`);
    return null;
  } else {
    const body = {
      name: PROJECT, framework: 'nextjs',
      ...(repo ? { gitRepository: { type: 'github', repo } } : {}),
      resourceConfig: { fluid: true },
      oidcTokenConfig: { enabled: true, issuerMode: 'team' },
    };
    let created = await api('POST', `/v11/projects${q}`, body);
    if (!created.ok && repo) {
      // The GitHub app may not cover this repository yet; a project without the link still deploys from here.
      say(`Create with the GitHub link failed (${created.status}: ${created.json?.error?.message || 'no detail'}); creating unlinked.`);
      const { gitRepository, ...unlinked } = body;
      void gitRepository;
      created = await api('POST', `/v11/projects${q}`, unlinked);
    }
    if (!created.ok) {
      say(`Could not create the project (${created.status}: ${created.json?.error?.message || 'no detail'}).`);
      process.exit(1);
    }
    project = created.json;
    say(`Created "${PROJECT}" (${project.id}).`);
  }
  if (!PLAN) {
    // Settings that only matter once: Fluid compute and an OIDC issuer for the gateway/connect tokens.
    const patched = await api('PATCH', `/v9/projects/${project.id}${q}`, {
      resourceConfig: { fluid: true },
      oidcTokenConfig: { enabled: true, issuerMode: 'team' },
    });
    say(patched.ok ? 'Fluid compute and OIDC token: on.' : `Project settings not updated (${patched.status}: ${patched.json?.error?.message || 'no detail'}); continuing.`);
    if (repo && !project.link) {
      say(`Not linked to ${repo}: connect it in the dashboard (Settings → Git) or run \`vercel git connect\` once the GitHub app covers the repository.`);
    }
  }
  return project;
}

async function link(scope) {
  step('4. Link');
  if (PLAN) { say(`Would run: vercel link --yes --project ${PROJECT} --scope ${scope}`); return; }
  const r = await vercel(['link', '--yes', '--project', PROJECT, '--scope', scope]);
  if (r.code !== 0) { say('vercel link failed; the steps below need the project linked.'); process.exit(1); }
}

/**
 * key -> the set of targets it is set on, or `null` when the listing itself failed.
 *
 * Both distinctions are load-bearing. A failed listing read as an empty project makes every
 * GENERATED secret look absent, and `variables()` pushes with `upsert=true` — so a network blip
 * would silently rotate CONFIRMATION_SECRET and BETTER_AUTH_SECRET, invalidating every
 * outstanding RSVP link and every session. And Vercel stores one record PER value, so a key with
 * a different value in production and preview arrives as two records; keeping only the last one
 * would report it missing from the target the first record covered.
 */
async function envKeys(project, scope) {
  if (!bearer || !project) return new Map();
  const r = await api('GET', `/v10/projects/${project.id}/env?teamId=${encodeURIComponent(scope)}`);
  if (!r.ok) return null;
  const map = new Map();
  for (const e of r.json?.envs || []) {
    const targets = map.get(e.key) ?? new Set();
    for (const t of e.target || []) targets.add(t);
    map.set(e.key, targets);
  }
  return map;
}

/**
 * The free (or cheapest) plan of a Marketplace product, so the install needs no prompt. The
 * shape of these endpoints is read defensively: on any surprise the install runs without --plan
 * and the CLI says what it needs.
 */
async function freePlan(slug, scope) {
  if (!bearer) return null;
  try {
    const q = `?teamId=${encodeURIComponent(scope)}`;
    const integration = await api('GET', `/v1/integrations/integration/${slug}${q}`);
    const products = integration.json?.products || [];
    for (const product of products) {
      const plans = await api('GET', `/v1/integrations/integration/${slug}/products/${product.id}/plans${q}`);
      const list = plans.json?.plans || [];
      const free = list.find((p) => /free|hobby/i.test(`${p.name} ${p.id}`) || p.cost === '$0' || p.paymentMethodRequired === false) || list[0];
      if (free?.id) return free.id;
    }
  } catch { /* fall through */ }
  return null;
}

async function connectors(project, scope) {
  step('5. Connectors (Vercel Marketplace)');
  if (flag('skip-integrations')) { say('Skipped (--skip-integrations).'); return new Set(); }
  const keys = await envKeys(project, scope);
  if (!keys) { say('Could not list this project\'s variables; skipping connectors rather than installing over one that is already there.'); return new Set(); }
  const owned = new Set();
  for (const c of CONNECTORS) {
    const present = c.gives.find((k) => keys.has(k));
    if (present) {
      say(`${c.slug}: already connected (${present} is in the project).`);
      for (const k of c.owns) owned.add(k);
      continue;
    }
    if (PLAN) { say(`${c.slug}: would run \`vercel integration add ${c.slug} --name ${c.name}\` and let it inject its variables.`); continue; }
    const plan = await freePlan(c.slug, scope);
    say(`${c.slug}: installing${plan ? ` (plan ${plan})` : ''} — this provisions the ${c.slot} and writes its variables into the project.`);
    const argv = ['integration', 'add', c.slug, '--name', c.name, '--scope', scope, '--no-env-pull', ...(plan ? ['--plan', plan] : [])];
    const r = await vercel(argv);
    if (r.code !== 0) {
      say(`${c.slug}: the CLI could not finish this on its own. Finish it at https://vercel.com/marketplace/${c.slug} (one press, then it injects the variables), or re-run once it has.`);
      continue;
    }
    for (const k of c.owns) owned.add(k);
  }
  return owned;
}

async function variables(project, scope, owned) {
  step('6. Variables');
  if (!bearer || !project) { say('(no token or project: skipped)'); return; }
  const keys = await envKeys(project, scope);
  if (!keys) { say('Could not list this project\'s variables; setting none, because minting over a secret that is already there would invalidate every live session and RSVP link.'); return; }
  const q = `?teamId=${encodeURIComponent(scope)}&upsert=true`;
  const batch = [];
  const add = (key, value, targets = TARGETS, type = 'sensitive') => {
    if (!value) return;
    const have = keys.get(key);
    const missing = targets.filter((t) => !have?.has(t));
    if (!missing.length) return;
    batch.push({ key, value: String(value), type, target: missing });
  };

  // The site's own secrets: generated here, once.
  for (const [key, bytes] of GENERATED) add(key, randomBytes(bytes).toString('base64url'));

  // The canonical public origin: a custom domain if one is attached, else a .vercel.app domain
  // this project ACTUALLY has — never `${project.name}.vercel.app` inferred from the name.
  //
  // That inference is what this deploy shipped first, and `.vercel.app` is a global namespace: for
  // a project called `wedding` it resolved to a stranger's live wedding site, HTTP 200. It is the
  // value of BETTER_AUTH_URL, so it is the passkey relying-party id and the origin auth is checked
  // against, and of NEXT_PUBLIC_SITE_URL, so it is the address in every e-mail a guest receives.
  // A name nobody here owns is the worst of the three places this could have been wrong.
  const domains = await api('GET', `/v9/projects/${project.id}/domains?teamId=${encodeURIComponent(scope)}`);
  // A failed listing is not an empty one: reporting "no domain is attached" for a network error
  // would quietly leave the origin on whatever it was, which is the bug this block is about.
  const listed = domains.ok ? (domains.json?.domains || []) : null;
  if (!listed) say('Could not list this project\'s domains; leaving the public origin alone.');
  // Only a domain that SERVES this project's production branch can be its origin. A redirect
  // sends the passkey relying party somewhere else, an unverified domain is not ours yet, and a
  // branch domain serves something other than production.
  const usable = (listed || []).filter((d) => d.name && !d.redirect && d.verified !== false && !d.gitBranch);
  const names = usable.map((d) => d.name);
  const host = names.find((n) => !n.endsWith('.vercel.app')) ?? names.find((n) => n.endsWith('.vercel.app'));
  if (listed && !host) {
    say('No domain is attached to this project, so the public origin cannot be derived.');
    say(`Attach one — \`vercel domains add <domain> ${project.name}\` — and re-run.`);
    say('Leaving BETTER_AUTH_URL and NEXT_PUBLIC_SITE_URL unset.');
  } else if (host) {
    // Origin variables RECONCILE rather than only fill a gap: `add` skips a key the project
    // already has, which would strand both of these on the first host the project ever had, and
    // attaching the real domain later would silently change nothing.
    const origin = `https://${host}`;
    for (const key of ['BETTER_AUTH_URL', 'NEXT_PUBLIC_SITE_URL']) {
      batch.push({ key, value: origin, type: 'plain', target: ['production'] });
    }
    say(`Public origin: ${origin}${names.length > 1 ? ` (of ${names.length} domains on this project)` : ''}`);
  }
  // Previews take their origin from VERCEL_URL (src/lib/env.ts derives both when unset).

  // What the Secret Drop already acquired, minus what a connector now owns.
  const local = existsSync(join(repoRoot, '.env')) ? await readEnv(join(repoRoot, '.env')) : new Map();
  const mirrored = [];
  for (const key of MIRROR) {
    if (owned.has(key)) continue;
    const value = local.get?.(key) ?? local[key];
    if (!value) continue;
    // src/lib/env.ts refuses to boot production with RATE_LIMIT_BACKEND=memory (per-process
    // buckets are not a rate limit behind a load balancer). It is a perfectly ordinary value in a
    // developer's .env, and mirroring it would deploy READY and then 500 on every route, for a
    // reason no missing-variable check would ever name. Keep it local.
    if (key === 'RATE_LIMIT_BACKEND' && String(value) === 'memory') {
      say('RATE_LIMIT_BACKEND=memory is a local-only value (production refuses it); not mirroring it.');
      continue;
    }
    add(key, value, TARGETS, key.startsWith('NEXT_PUBLIC_') ? 'plain' : 'sensitive');
    mirrored.push(key);
  }

  if (!batch.length) { say('Nothing to set; every variable is already in the project.'); return; }
  say(`Setting ${batch.length} variable${batch.length === 1 ? '' : 's'}:`);
  for (const b of batch) say(`  ${b.key.padEnd(28)} ${b.type.padEnd(9)} ${b.target.join(',')}  (${b.value.length} chars${mirrored.includes(b.key) ? ', from .env' : ''})`);
  if (PLAN) return;
  const r = await api('POST', `/v10/projects/${project.id}/env${q}`, batch);
  if (!r.ok) { say(`Variables not set (${r.status}: ${r.json?.error?.message || 'no detail'}).`); process.exit(1); }
  const failed = r.json?.failed || [];
  if (failed.length) for (const f of failed) say(`  not set: ${f.error?.key || '?'} — ${f.error?.message || 'no detail'}`);

  const still = ['EMAIL_FROM', 'ADMIN_EMAILS'].filter((k) => !keys.has(k) && !batch.some((b) => b.key === k));
  if (still.length) say(`Still needed, and only the couple can say: ${still.join(', ')} — the Secret Drop's email strip asks for the first; the admin guide covers the second.`);
}

function cron() {
  step('7. Cron');
  // Read the file rather than restate it: this said `/api/jobs/run` alone while vercel.json
  // declared three, and one cron covering two job routes is a defect this repo has already had
  // once — uploads sat in "Checking" because nothing ran /api/uploads/jobs/run.
  let crons = [];
  try {
    crons = JSON.parse(readFileSync(join(repoRoot, 'vercel.json'), 'utf8')).crons ?? [];
  } catch {
    say('vercel.json could not be read; check its cron entries by hand.');
    return;
  }
  if (!crons.length) { say('vercel.json declares no crons.'); return; }
  say(`vercel.json declares ${crons.length} cron${crons.length === 1 ? '' : 's'}; Vercel adds \`Authorization: Bearer $CRON_SECRET\` to each call itself.`);
  for (const c of crons) say(`  GET ${c.path}  ${c.schedule}`);
}

/**
 * What `src/lib/env.ts` refuses to boot production without, read out of that file rather than
 * copied into this one. A copy would rot the first time someone adds a variable to the check, and
 * rot here is expensive: the whole point of the preflight below is to be right about this list.
 */
async function requiredInProduction() {
  const src = await readFile(join(repoRoot, 'src/lib/env.ts'), 'utf8');
  const block = /const required:[^=]*=\s*\[([\s\S]*?)\]/.exec(src);
  const keys = block ? [...block[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]) : [];
  // Nothing parsed means the shape of that file changed. Say so; do not report an empty set as a
  // clean bill of health, and do not let the DATABASE_URL push below disguise it as one.
  if (!keys.length) return null;
  // Named in the same guard but outside that array, and only for a production target.
  if (src.includes("missing.push('DATABASE_URL")) keys.push('DATABASE_URL');
  // A connector never writes `DATABASE_URL`: `vercel integration add supabase` writes
  // `POSTGRES_URL`, and env.ts reads it under the name the app uses. Checking for the literal key
  // reported a database that was demonstrably connected — the first version of this preflight did
  // exactly that, while the deployment's own error named RESEND_API_KEY alone.
  const aliased = /DATABASE_URL_ALIASES\s*=\s*\[([^\]]*)\]/.exec(src);
  const aliases = aliased ? [...aliased[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]) : [];
  return keys.map((key) => (key === 'DATABASE_URL' ? [key, ...aliases] : [key]));
}

/**
 * Do not ship a deployment that provably cannot serve a request.
 *
 * The first deploy of this project built READY and then answered 500 on every route, including
 * `/api/health`, because the instrumentation hook throws when a required variable is absent — and
 * a connector that did not finish leaves exactly that hole. READY is a statement about the build,
 * not about the app, so the build succeeding is not evidence of anything a guest would notice.
 */
async function preflight(project, scope) {
  step('8. Preflight');
  if (!bearer || !project) { say('(no token or project: skipped)'); return true; }
  const keys = await envKeys(project, scope);
  if (!keys) {
    say('Could not list this project\'s variables, so this preflight cannot tell set from unset.');
    say('It is not vouching for this deploy; check the production guard in src/lib/env.ts by hand.');
    return true;
  }
  const required = await requiredInProduction();
  if (!required) {
    say('Could not read the required set out of src/lib/env.ts — its shape must have changed.');
    say('This preflight cannot vouch for the deploy; check the production guard there by hand.');
    return true;
  }
  const target = PROD ? 'production' : 'preview';
  const has = (name) => keys.get(name)?.has(target);
  const satisfied = (names) => names.some(has);
  // A preview derives its own origin from VERCEL_URL (src/lib/env.ts), so it is not owed one.
  const wanted = PROD ? required : required.filter((names) => names[0] !== 'BETTER_AUTH_URL');
  const missing = wanted.filter((names) => !satisfied(names));
  // The same guard in env.ts refuses two more things, and a deploy that trips either of them
  // 500s exactly as loudly as a missing key. Modelling only the `required` array would let this
  // wave through the failure it exists to catch.
  if (!has('STORAGE_SIGNING_SECRET') && !has('DEV_STORAGE_SECRET')
      && !['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].every(has)) {
    missing.push(['STORAGE_SIGNING_SECRET', 'DEV_STORAGE_SECRET', 'or S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY']);
  }
  // A missing mailer is not a refusal. env.ts deliberately keeps RESEND_API_KEY and EMAIL_FROM
  // out of `required` so a site with no mail still boots and still shows the date of the wedding.
  // But `createAuthEmailProvider` throws on the one action that needs them, so RSVP sign-in is dead
  // until both are set — say it here, rather than let a guest be the one to find out.
  if (PROD) {
    const noMail = ['RESEND_API_KEY', 'EMAIL_FROM'].filter((n) => !has(n));
    if (noMail.length) say(`Warning: ${noMail.join(' and ')} not set — every page still renders, but RSVP cannot send a sign-in code.`);
  }

  if (!missing.length) { say(`Everything ${target} needs is set (${wanted.length} variables, plus storage).`); return true; }
  say(`${missing.length} thing${missing.length === 1 ? '' : 's'} ${target} needs ${missing.length === 1 ? 'is' : 'are'} missing:`);
  for (const names of missing) say(`  ${names[0]}${names.length > 1 ? `  (or ${names.slice(1).join(', ')})` : ''}`);
  say('');
  say('The build would go READY and every route would answer 500, which is what happened the first');
  say('time this ran. Set them (a connector, the Secret Drop, or `vercel env add`) and re-run.');
  say('To deploy anyway: --skip-preflight.');
  return false;
}

async function deploy(scope) {
  step(PROD ? '9. Deploy (production)' : '9. Deploy (preview)');
  if (PLAN) { say(`Would run: vercel deploy --yes${PROD ? ' --prod' : ''} --scope ${scope}`); return; }
  const r = await vercel(['deploy', '--yes', ...(PROD ? ['--prod'] : []), '--scope', scope]);
  const url = (r.out.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/g) || []).pop();
  if (r.code !== 0 || !url) { say('Deploy did not return a URL; see the CLI output above.'); process.exit(r.code || 1); }
  say(`\nDeployment: ${url}`);
  if (!bearer) return;
  const q = `?teamId=${encodeURIComponent(scope)}`;
  for (let i = 0; i < 120; i += 1) {
    const d = await api('GET', `/v13/deployments/${encodeURIComponent(url.replace('https://', ''))}${q}`);
    const state = d.json?.readyState || d.json?.state;
    if (state === 'READY') { say('Build: READY.'); return; }
    if (state === 'ERROR' || state === 'CANCELED') {
      say(`Build: ${state}. Last build events:`);
      const ev = await api('GET', `/v3/deployments/${d.json.id}/events${q}&limit=60`);
      for (const e of (Array.isArray(ev.json) ? ev.json : []).slice(-40)) say(`  ${e.text || e.payload?.text || ''}`);
      process.exit(1);
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  say('Build still running after ten minutes; check the dashboard.');
}

/* ------------------------------------------------------------------ run */

if (!existsSync(VERCEL_BIN)) { console.error('The Vercel CLI is not installed at node_modules/.bin/vercel — run `npm install`.'); process.exit(2); }
say(PLAN ? 'Plan only — nothing is written.' : `Deploying "${PROJECT}"${PROD ? ' to production' : ' as a preview'}.`);
await ensureSession();
const scope = await resolveScope();
const project = await ensureProject(scope);
await link(scope);
const owned = await connectors(project, scope);
await variables(project, scope, owned);
cron();
// `--skip-preflight` skips it, rather than paying for it and printing a refusal before deploying
// anyway; and a plan reports without ever failing, because a plan writes nothing to fail about.
let cleared = true;
if (flag('skip-preflight')) { step('8. Preflight'); say('Skipped (--skip-preflight).'); }
else cleared = await preflight(project, scope);
if (cleared || PLAN) await deploy(scope);
else process.exit(1);

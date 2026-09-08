/**
 * Sign in to a provider whose credential is a CLI session on THIS machine.
 *
 * Some providers do not issue an API key at all. Higgsfield is one: the vendored `@higgsfield/cli`
 * runs its own OAuth and writes a credentials file, and `.claude/skills/higgsfield-*` call
 * `higgsfield account status` rather than reading a variable. There is nothing for the Secret Drop
 * to seal, which for a while I treated as a reason the page could not offer the connection at all.
 * That was wrong: the machine running this has a shell, the CLI prints a URL to approve, and
 * `runJob` already streams a job's output into the record the page renders. So the session is
 * acquired here and the terminal is streamed — the approval happens in the person's own browser,
 * and nothing secret has to travel through the page to make it work.
 *
 * Invoked only through `HANDOFF_WORK.cli` in serve.mjs, which maps an id written in this repo to
 * fixed argv. The id is validated against LOGINS below as well: a string from a store record must
 * never be able to choose what runs.
 *
 *   node scripts/secrets/cli-login.mjs higgsfield [--check]
 *
 * `--check` only reports whether the session is already good, and never starts a login.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Every CLI this may drive, with the exact arguments. No interpolation, no shell: `spawn` is
 * given an argv array and `shell` is never set, so nothing here can become a command injection
 * even if a record asked for it.
 */
const LOGINS = {
  higgsfield: {
    name: 'Higgsfield',
    bin: 'node_modules/.bin/higgsfield',
    status: ['account', 'status'],
    login: ['auth', 'login'],
  },
};

const [, , id, ...rest] = process.argv;
const checkOnly = rest.includes('--check');
const spec = LOGINS[id];

if (!spec) {
  console.error(`cli-login: no login is defined for "${id}". Known: ${Object.keys(LOGINS).join(', ') || '(none)'}`);
  process.exit(2);
}

const bin = resolve(repoRoot, spec.bin);
if (!existsSync(bin)) {
  console.error(`cli-login: ${spec.name}'s CLI is not installed at ${spec.bin} — run \`npm install\` first.`);
  process.exit(2);
}

/** Run one CLI command, streaming it as it goes so the page shows the URL to approve. */
function run(args, { inherit = false } = {}) {
  return new Promise((done) => {
    const child = spawn(bin, args, {
      cwd: repoRoot,
      // No shell, ever. argv only.
      shell: false,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    if (!inherit) {
      const take = (c) => { out += String(c); process.stdout.write(String(c)); };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
    }
    child.on('error', (e) => done({ code: 127, out: out + '\n' + e.message }));
    child.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

const status = await run(spec.status);
if (status.code === 0) {
  console.log(`${spec.name} is already signed in on this machine.`);
  process.exit(0);
}
if (checkOnly) {
  console.error(`${spec.name} has no usable session here.`);
  process.exit(1);
}
/*
 * Any failed status means the login is worth attempting.
 *
 * This first tried to recognise "not authenticated" and refuse to log in for anything else, so as
 * not to bury an unrelated error. Run against the real CLI it answered `No workspace selected.` —
 * which that pattern does not match, so the guard would have refused to sign in precisely the
 * person who needed to. The post-login check below is the honest guard: it asks the CLI again and
 * believes the answer, rather than trying to predict the CLI's wording.
 */
console.log(`Signing in to ${spec.name}. It prints a link below — open it and approve; this waits.`);
const login = await run(spec.login);
if (login.code !== 0) {
  console.error(`${spec.name} sign-in did not complete (exit ${login.code}).`);
  process.exit(login.code);
}

// Signed in is a claim; this is the check of it. A login that "succeeded" while leaving no usable
// session is exactly the kind of green-for-the-wrong-reason this page exists to stop.
const after = await run(spec.status);
if (after.code !== 0) {
  // Say what the CLI said, because the remaining step is often something only it knows about —
  // `No workspace selected.` comes with its own `hf workspace set <id>` hint, and swallowing that
  // would leave a failure nobody can act on.
  const why = after.out.trim().split('\n').filter(Boolean).slice(-3).join(' / ');
  console.error(`${spec.name} signed in, but the session is still not usable: ${why || '(no output)'}`);
  process.exit(1);
}
console.log(`${spec.name} is signed in.`);

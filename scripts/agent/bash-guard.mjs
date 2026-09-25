#!/usr/bin/env node
/**
 * PreToolUse guard for agent Bash commands (.claude/settings.json). It refuses the three command
 * shapes that left a session on 2026-09-24 with four immortal shell loops, a 5 GB dev server and a
 * 12 GB swap file, and says what to do instead. Exit 2 blocks the command; stderr is the reason.
 *
 * 1. `pgrep -f` / `pkill -f` / `killall`. The Bash tool runs every command inside `bash -c "…"`,
 *    so a full-command-line pattern always matches the shell running it. `until ! pgrep -f "npm ci"`
 *    therefore never ended, and `pkill -f "next dev"` killed the calling shell (exit 144).
 * 2. A wait loop (`until`/`while` … `sleep`) with no `timeout N` around it. The ones that ran for
 *    hours were all waiting on a condition that could no longer become true.
 * 3. `swapon`. Swap outlives the command that needed it, and its file sat on the session's disk.
 *
 * `checkCommand` is exported for the unit test (tests/unit/agent/bash-guard.test.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where a command word can start: the beginning, after a separator or `!`, or after a keyword or `bash -c '`. */
const AT_COMMAND = String.raw`(?:^|[;&|(!\n]\s*|\b(?:do|then|else|until|while|if|exec|timeout\s+\d+)\s+|\bbash\s+-c\s+['"])`;

const RULES = [
  {
    test: new RegExp(`${AT_COMMAND}(?:(?:pgrep|pkill)\\b[^|;&\\n]*\\s-[a-zA-Z]*f\\b|killall\\b)`),
    why:
      '`pgrep -f` / `pkill -f` / `killall` match the full command line, and this command itself runs inside `bash -c "…"` that contains the pattern: it matches its own shell (a wait on it never ends; a kill of it kills the caller). Keep the PID instead (`cmd & echo $! > pidfile`, or the PID from `ps -eo pid,comm,args` read in one step and killed in the next), or match the process name exactly with `pgrep -x`.',
  },
  {
    test: (cmd) => /\b(until|while)\b[\s\S]*\bdo\b[\s\S]*\bsleep\b/.test(cmd) && !/(^|[;&|(]\s*|\bexec\s+)timeout\s+(-\S+\s+)*\d+/.test(cmd),
    why:
      'A wait loop (`until`/`while` … `sleep`) needs a bound: prefix it with `timeout <seconds>` so it cannot outlive what it waits for. A condition that can never become true otherwise loops for the rest of the session.',
  },
  {
    test: new RegExp(`${AT_COMMAND}swapon\\b`),
    why:
      '`swapon` leaves swap (and its file on the session disk) behind after the command that needed it. If a dev server runs out of memory, stop the other servers first (one Next server at a time), or run the specs against a production build.',
  },
];

export function checkCommand(command) {
  // A heredoc body is a file being written (a script, docs), not something this shell runs.
  const cmd = String(command ?? '').replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<heredoc');
  for (const rule of RULES) {
    const hit = typeof rule.test === 'function' ? rule.test(cmd) : rule.test.test(cmd);
    if (hit) return rule.why;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0); // not ours to judge
  }
  const reason = checkCommand(input?.tool_input?.command);
  if (reason) {
    process.stderr.write(`bash-guard: ${reason}\n`);
    process.exit(2);
  }
}

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every destructive admin action asks for an explicit yes.
 *
 * This used to be `admin-confirm.test.ts`, which posted each console form's server action without
 * `confirm=yes` and checked it refused. The screens moved to the admin kit, whose flows call
 * capabilities directly, and those actions are gone. The guarantee now has two halves:
 *
 *   - tests/ui/admin-flow.test.tsx proves the kit: a `tone="danger"` flow calls nothing until its
 *     confirmation is ticked, and says why when it is not;
 *   - this file proves every screen uses it: wherever a flow is marked `tone="danger"`, the same
 *     module confirms with a `CheckField` and gates its step with `ready`.
 *
 * A new screen that deletes, revokes or resets with a bare button fails here.
 */
const ROOTS = ['src/app/(admin)', 'src/components/media', 'src/components/mediaai'].map((r) => path.resolve(__dirname, '../..', r));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

// The JSX attribute, on its own line as the kit's flows are written — not a mention in a comment.
const DANGER = /^\s*tone="danger"\s*$/m;

describe('destructive admin flows confirm first', () => {
  const files = ROOTS.flatMap(sources).filter((f) => DANGER.test(readFileSync(f, 'utf8')));

  it('finds the destructive flows', () => {
    // Guests, households, seating, invitations, transport, travel, jobs, flags and the media queue
    // each delete, revoke, withdraw, cancel or reject something.
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(ROOTS.flatMap(sources).filter((f) => DANGER.test(readFileSync(f, 'utf8'))).map((f) => [path.relative(path.resolve(__dirname, '../..'), f), f]))('%s confirms with a gated CheckField', (_rel, file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/<CheckField\b/);
    expect(src).toMatch(/\bready:\s*\(/);
  });
});

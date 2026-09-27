import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Admin forms carry their render-time idempotency key in a hidden field, and the action has to read
 * the field by the name the form posts. The console's `<IdemKey />` posts `idem`. The events, RSVP,
 * seating and content actions once read `idempotencyKey` from `<IdemKey />` forms, so every
 * submission got a fresh key and a double-submit ran twice. This pins the pairing structurally.
 *
 * The content editor's `RecordForm` was the one form that posted a field named `idempotencyKey`
 * (read by `saveRecordAction`). It is now an admin-kit flow that calls `save_content_record`
 * through /api/capabilities with the key in the request body, so no admin form posts a field of
 * that name, and none may start reading one.
 */
const ADMIN = path.resolve(__dirname, '../../src/app/(admin)');
const LITERAL = /(['"`])idempotencyKey\1/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const rel = (p: string) => path.relative(ADMIN, p).split(path.sep).join('/');

describe('admin forms and actions agree on the idempotency field name', () => {
  const files = sources(ADMIN);

  it('finds the admin sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no admin form posts, and no admin action reads, a field named 'idempotencyKey'", () => {
    const hits = files.flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      return [...src.matchAll(LITERAL)].map(() => rel(f));
    });
    expect(hits).toEqual([]);
    for (const f of files) expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/name="idempotencyKey"/);
  });

  it("IdemKey posts 'idem', and the admin action helpers read 'idem'", () => {
    const ops = readFileSync(path.join(ADMIN, 'admin/_components/ops.tsx'), 'utf8');
    expect(ops).toMatch(/export function IdemKey\(\)[\s\S]*?name="idem"/);

    // Every other server-action module that forwards a form's key reads it as `idem`.
    const actionModules = files.filter((f) => /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')) && !rel(f).startsWith('admin/content/'));
    // Fewer every time a screen moves to the admin kit, whose flows call capabilities directly; the
    // check is that the scan still finds the ones that remain, not how many there are.
    expect(actionModules.length).toBeGreaterThan(0);
    for (const f of actionModules) {
      const src = readFileSync(f, 'utf8');
      if (!/idempotencyKey/.test(src)) continue;
      // `field(fd, 'idem')`, `str(fd, 'idem')` (via `idem(fd)`), or travel's `field.idempotencyKey(fd)`, which accepts `idem`.
      expect(/(['"])idem\1/.test(src) || /field\.idempotencyKey\(/.test(src), rel(f)).toBe(true);
    }
  });
});

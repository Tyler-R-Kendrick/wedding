/**
 * The promotion board: where every page stands in the pipeline, and who signed off what.
 *
 * A stage's question ("what goes on the page?", "can you click through it?", "does it work in
 * each design?") is settled when someone, usually Sara or Tyler, signs that page off at that
 * stage. A sign-off records the fingerprint of the page it approved: the structure of its baseline
 * (the real page as captured, stages/02-wireframe/lib/baseline.ts), or of its drawn wireframe when
 * it is not built yet. When that changes afterwards (a re-capture after the real page's layout
 * moved, say), the sign-off shows as stale instead of silently vouching for a page it never saw.
 * Copy edits do not change it. Sign-offs live in stages/signoffs.json and are added with
 * `npm run stages:signoff`.
 *
 * Read by scripts/stages/hub.ts (the dev hub's board), scripts/stages/signoff.ts and
 * tests/unit/stages/board.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, SECTIONS, href, type SitemapPage } from '@wedding/sitemap';
import { fingerprint, wireframeFor, type WireframeStatus } from '@wedding/wireframe';
import { baselineFor, structureFingerprint } from '@wedding/wireframe/baseline';

export const SIGNOFF_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../stages/signoffs.json');

/** The stages a page can be signed off at. The sitemap is settled by being in it; the real app by shipping. */
export const SIGNABLE = ['wireframe', 'skeleton', 'placeholder'] as const;
export type SignableStage = (typeof SIGNABLE)[number];

export interface Signoff {
  page: string;
  stage: SignableStage;
  by: string;
  /** ISO date. */
  on: string;
  /** The fingerprint of the page this sign-off approved (pageFingerprint). Named for history. */
  wireframe: string;
  note?: string;
}

export interface SignoffFile {
  $comment?: string;
  signoffs: Signoff[];
}

export function readSignoffs(file = SIGNOFF_FILE): SignoffFile {
  return JSON.parse(readFileSync(file, 'utf8')) as SignoffFile;
}

/** Everything wrong with the ledger. The board test fails on any of these. */
export function validateSignoffs(ledger: SignoffFile): string[] {
  const errors: string[] = [];
  const pages = new Set(PAGES.map((p) => p.id));
  ledger.signoffs.forEach((s, i) => {
    const at = `signoffs[${i}]`;
    if (!pages.has(s.page)) errors.push(`${at}: page "${s.page}" is not in the sitemap`);
    if (!(SIGNABLE as readonly string[]).includes(s.stage)) errors.push(`${at}: "${s.stage}" is not a stage that takes sign-offs (${SIGNABLE.join(', ')})`);
    if (!s.by?.trim()) errors.push(`${at}: who signed it off?`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.on ?? '') || Number.isNaN(Date.parse(s.on))) errors.push(`${at}: "on" must be an ISO date`);
    if (!/^[0-9a-f]{8}$/.test(s.wireframe ?? '')) errors.push(`${at}: "wireframe" must be the 8-hex fingerprint it approved`);
  });
  return errors;
}

export type Approval =
  | { state: 'open' }
  | { state: 'signed'; by: string; on: string; note?: string }
  | { state: 'stale'; by: string; on: string; note?: string };

export interface BoardRow {
  page: SitemapPage;
  url: string;
  /** `captured`: redrawn from the real page. Otherwise drawn (or derived) in stages/02-wireframe. */
  wireframe: { status: WireframeStatus | 'captured'; fingerprint: string; capturedAt?: string; source?: string };
  approvals: Record<SignableStage, Approval>;
}

/** What a sign-off approves: the baseline's structure, or the drawn wireframe of a page not built yet. */
export function pageFingerprint(id: string): string {
  return structureFingerprint(id) ?? fingerprint(wireframeFor(id));
}

/** The latest sign-off per page and stage wins; the ledger keeps the history. */
export function board(ledger: SignoffFile = readSignoffs()): BoardRow[] {
  return PAGES.map((page) => {
    const w = wireframeFor(page.id);
    const captured = baselineFor(page.id);
    const fp = pageFingerprint(page.id);
    const approvals = Object.fromEntries(
      SIGNABLE.map((stage) => {
        const latest = ledger.signoffs.filter((s) => s.page === page.id && s.stage === stage).sort((a, b) => a.on.localeCompare(b.on)).at(-1);
        const approval: Approval = !latest
          ? { state: 'open' }
          : { state: latest.wireframe === fp ? 'signed' : 'stale', by: latest.by, on: latest.on, note: latest.note };
        return [stage, approval];
      }),
    ) as Record<SignableStage, Approval>;
    const wireframe = captured ? { status: 'captured' as const, fingerprint: fp, capturedAt: captured.capturedAt, source: captured.principal ? 'app' : captured.source } : { status: w.status, fingerprint: fp };
    return { page, url: href(page), wireframe, approvals };
  });
}

export function sections() {
  return SECTIONS;
}

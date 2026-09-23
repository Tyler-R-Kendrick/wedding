import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PAGES } from '@wedding/sitemap';

const out = mkdtempSync(path.join(os.tmpdir(), 'hub-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('the dev hub', () => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.STAGES_DEV_DOMAIN;
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/stages/hub.ts', out], { env, stdio: 'ignore' });
  const html = readFileSync(path.join(out, '_hub', 'index.html'), 'utf8');

  it('is written under _hub, which the app serves at dev.<domain>/ and /stages', () => {
    expect(() => readFileSync(path.join(out, 'index.html'))).toThrow();
    expect(html).toContain('<title>Tyler &amp; Sara · dev</title>');
  });

  it('has a board row, linked by path, for every sitemap page at every pipeline stage', () => {
    for (const p of PAGES) {
      const url = p.example ?? p.path;
      for (const stage of ['sitemap', 'wireframe', 'skeleton', 'placeholder']) expect(html, `${p.id} at ${stage}`).toContain(`href="/${stage}${url === '/' ? '' : url}"`);
    }
  });

  it('links straight to the stage subdomains when the dev domain is known (the production build)', () => {
    const prod = mkdtempSync(path.join(os.tmpdir(), 'hub-prod-'));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/stages/hub.ts', prod], { env: { ...env, STAGES_DEV_DOMAIN: 'dev.kendrick.wedding' }, stdio: 'ignore' });
    const page = readFileSync(path.join(prod, '_hub', 'index.html'), 'utf8');
    rmSync(prod, { recursive: true, force: true });
    expect(page).toContain('href="https://skeleton.dev.kendrick.wedding/rsvp"');
    expect(page).toContain('href="https://kendrick.wedding/rsvp"');
  });

  it('escapes what it prints and leaves no template holes', () => {
    expect(html).toContain('Tyler &amp; Sara');
    expect(html).not.toMatch(/undefined|\[object Object\]/);
  });
});

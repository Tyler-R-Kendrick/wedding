import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listThemes } from '@/themes/registry';

/**
 * The web fonts are cut down by hand-run tooling (scripts/fonts/README.md). These checks are the
 * part that can go stale without anyone running it: a new accented letter in the copy, a preload
 * pointing at a file that is gone, a stylesheet naming a font that was not generated.
 */
interface FontsConfig {
  chars: number[];
  fonts: { source: string; name: string }[];
}
const config = JSON.parse(readFileSync('scripts/fonts/fonts.json', 'utf8')) as FontsConfig;
const report = JSON.parse(readFileSync('scripts/fonts/report.json', 'utf8')) as { source: string; files: { file: string; bytes: number }[] }[];

/** Every character U+00A0–U+017F in the copy a guest reads (letters and Latin-1 signs). */
function latinCharactersInCopy(): Map<number, string> {
  const found = new Map<number, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.json$/.test(entry.name)) for (const ch of readFileSync(path, 'utf8')) if (ch.codePointAt(0)! >= 0xa0 && ch.codePointAt(0)! < 0x180) found.set(ch.codePointAt(0)!, path);
    }
  };
  walk('src/content/seed');
  return found;
}

describe('the generated web fonts', () => {
  it('are the files the last run reported, byte for byte in size', () => {
    expect(report.map((r) => r.source).sort()).toEqual(config.fonts.map((f) => f.source).sort());
    for (const entry of report) for (const file of entry.files) expect(statSync(join('public/fonts', file.file)).size, file.file).toBe(file.bytes);
  });

  it('every font a stylesheet or a preload names exists', () => {
    for (const theme of listThemes()) {
      const css = readFileSync(`src/themes/${theme.id}/fonts.css`, 'utf8');
      const urls = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]!);
      expect(urls.length, theme.id).toBeGreaterThan(0);
      // Each is its file's address by content: the hash in `?v=` is the file's own, so the address
      // can be served as immutable (next.config.ts) and a regenerated file gets a new one.
      for (const url of urls) {
        const [file, version] = url.split('?v=');
        expect(existsSync(join('public', file!)), url).toBe(true);
        expect(version, url).toBe(createHash('sha256').update(readFileSync(join('public', file!))).digest('hex').slice(0, 12));
      }
      // A preload names the stylesheet's own address, or the browser fetches the font twice. And
      // what is preloaded is the small core file of a face, never the extended one.
      for (const font of theme.fonts) {
        expect(urls, `${font.family}: copy its address from src/themes/${theme.id}/fonts.css`).toContain(font.url);
        expect(font.url, font.family).toMatch(/-core\.woff2\?v=/);
      }
    }
  });

  it('keeps every accented letter and sign the copy uses in the preloaded core file', () => {
    // Text is shaped one file at a time, so a letter in the extended file loses its kerning with
    // its neighbours. Add it to `chars` in scripts/fonts/fonts.json and rerun scripts/fonts/subset.py.
    const missing = [...latinCharactersInCopy()].filter(([cp]) => !config.chars.includes(cp)).map(([cp, path]) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${String.fromCodePoint(cp)} (${path})`);
    expect(missing).toEqual([]);
  });

  it('serves no foundry original: the sources live outside public/', () => {
    for (const font of config.fonts) expect(existsSync(join('public/fonts', font.source)), font.source).toBe(false);
  });
});

/**
 * Runs inside a real page of the wedding site (page.evaluate from scripts/stages/capture.ts) and
 * turns what it rendered into a baseline: the same DOM, with every element marked for the role it
 * plays, so each design stage can redraw the page at its own fidelity from the real layout.
 *
 * Plain JavaScript on purpose: a function compiled by tsx carries helpers that do not exist in the
 * page, so this file is read as text and evaluated there.
 *
 * What it marks (and the stages rely on):
 *   data-bl-t="copy|heading|label"   every non-blank text node, wrapped in a <span> of its own
 *   data-bl-m="photo|art|icon"       media: a content photograph, a decorative illustration, an icon
 *   data-bl-s / data-bl-dark         an element that paints a surface (and whether it is dark)
 *   data-bl-b                        an element that draws a border
 *   data-bl-k + data-bl-label        a block: header, nav, main, section, form, figure, dialog, …
 * What it changes: scripts, preloads and dev overlays go; stylesheets are collected, not kept;
 * photographs are swapped for empty images of the same intrinsic size (the real bytes never reach
 * the baseline); internal links point at the sitemap page they belong to; forms lose their action.
 */
async ({ pages, textRoleLinkMax = 48 }) => {
  await document.fonts.ready;
  const loc = window.location;

  // --- Stylesheets, in document order, before anything is removed. --------------------------------
  const styles = [];
  for (const node of document.querySelectorAll('link[rel~="stylesheet"], style')) {
    if (node.tagName === 'LINK') {
      if (node.media === 'print') continue;
      styles.push({ href: new URL(node.getAttribute('href'), loc.href).href });
    } else if (node.textContent.trim()) {
      styles.push({ text: node.textContent });
    }
  }

  // --- Links seen as rendered (before rewriting), so patterned pages can find a real instance. ----
  const rawLinks = [];
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href'), loc.href);
      if (u.origin === loc.origin) rawLinks.push(u.pathname);
    } catch {}
  }

  const body = document.body;
  // Anything the scroll-through did not reach is shown as it would be once read (Botanical Deco's
  // kit/Reveal.tsx): a stage has none of the site's scripts to reveal it.
  body.querySelectorAll('[data-reveal-state]').forEach((el) => el.setAttribute('data-reveal-state', 'in'));
  body.querySelectorAll('script, noscript, template, nextjs-portal, next-route-announcer, link, style, [data-nextjs-toast], [data-nextjs-dialog-overlay]').forEach((n) => n.remove());

  const inSvg = (el) => el.parentElement && el.parentElement.closest('svg');
  const visible = (el, cs) => cs.display !== 'none' && cs.visibility !== 'hidden';
  const alpha = (color) => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return color === 'transparent' ? 0 : 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  };
  const luminance = (color) => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const [r, g, b] = m[1].split(/[\s,/]+/).map(parseFloat);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  // --- Surfaces, borders, blocks: read from the computed style, so no stage needs the real CSS's
  //     colours to know where one area ends and the next begins. -----------------------------------
  const BLOCKS = 'header, nav, main, footer, section, article, aside, form, figure, dialog, fieldset, [role="region"], [role="dialog"], [role="banner"], [role="contentinfo"]';
  for (const el of body.querySelectorAll('*')) {
    if (inSvg(el)) continue;
    const cs = getComputedStyle(el);
    if (!visible(el, cs) && el.tagName !== 'DIALOG') continue;
    const bg = alpha(cs.backgroundColor) > 0.02;
    if (bg || (cs.backgroundImage && cs.backgroundImage !== 'none')) {
      el.setAttribute('data-bl-s', '');
      if (bg && luminance(cs.backgroundColor) < 0.45) el.setAttribute('data-bl-dark', '');
    }
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && alpha(cs[`border${side}Color`]) > 0.02);
    if (bordered) el.setAttribute('data-bl-b', '');
    if (el.matches(BLOCKS)) {
      const kind = el.getAttribute('role') && !['section', 'nav', 'form'].includes(el.tagName.toLowerCase()) ? el.getAttribute('role') : el.tagName.toLowerCase();
      const labelledBy = el.getAttribute('aria-labelledby');
      const heading = el.querySelector('h1, h2, h3, h4, legend, figcaption');
      const label = (el.getAttribute('aria-label') || (labelledBy && document.getElementById(labelledBy.split(/\s+/)[0])?.textContent) || heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      el.setAttribute('data-bl-k', kind);
      if (label) el.setAttribute('data-bl-label', label);
    }
  }

  // --- Media. ------------------------------------------------------------------------------------
  const emptyImage = (w, h) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(w))}" height="${Math.max(1, Math.round(h))}"/>`)}`;
  const assetPath = (src) => {
    const u = new URL(src, loc.href);
    if (u.origin !== loc.origin) return null;
    // next/image serves an optimised copy of a file in public/; the stages use the file itself.
    if (u.pathname === '/_next/image' && u.searchParams.get('url')) return decodeURIComponent(u.searchParams.get('url'));
    return u.pathname;
  };
  const assets = new Set();
  for (const img of body.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    const decorative = img.getAttribute('alt') === '' || img.getAttribute('aria-hidden') === 'true' || ['presentation', 'none'].includes(img.getAttribute('role') || '');
    const icon = Math.max(r.width, r.height) > 0 && Math.max(r.width, r.height) <= 40;
    const src = img.currentSrc || img.getAttribute('src') || '';
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
    if (!decorative && !icon) {
      img.setAttribute('data-bl-m', 'photo');
      img.setAttribute('src', emptyImage(img.naturalWidth || r.width, img.naturalHeight || r.height));
    } else {
      img.setAttribute('data-bl-m', icon ? 'icon' : 'art');
      const path = src && assetPath(src);
      if (path) {
        img.setAttribute('src', path);
        assets.add(path);
      }
    }
  }
  for (const svg of body.querySelectorAll('svg')) {
    if (inSvg(svg)) continue;
    const r = svg.getBoundingClientRect();
    svg.setAttribute('data-bl-m', Math.max(r.width, r.height) <= 40 ? 'icon' : 'art');
    for (const use of svg.querySelectorAll('use')) {
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (ref && !ref.startsWith('#')) {
        const path = assetPath(ref.split('#')[0]);
        if (path) assets.add(path);
      }
    }
  }
  for (const el of body.querySelectorAll('video, canvas, iframe, object, embed')) {
    const r = el.getBoundingClientRect();
    const stand = document.createElement('img');
    stand.setAttribute('data-bl-m', 'photo');
    stand.setAttribute('alt', el.getAttribute('title') || el.getAttribute('aria-label') || '');
    stand.setAttribute('src', emptyImage(r.width, r.height));
    if (el.className && typeof el.className === 'string') stand.className = el.className;
    stand.setAttribute('style', `${el.getAttribute('style') || ''};width:${r.width}px;height:${r.height}px`);
    el.replaceWith(stand);
  }
  // An inline background photograph (a hero, a card) is content; a texture from the design is not.
  for (const el of body.querySelectorAll('[style*="url("]')) {
    const style = el.getAttribute('style');
    const kept = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (all, _q, url) => {
      const path = url.startsWith('data:') ? null : assetPath(url);
      if (path && /^\/(assets|fonts|icons|themes)\//.test(path)) {
        assets.add(path);
        return `url("${path}")`;
      }
      el.setAttribute('data-bl-m', 'photo');
      return 'none';
    });
    el.setAttribute('style', kept);
  }

  // --- Links and forms. --------------------------------------------------------------------------
  const matches = (pattern, path) => {
    const a = pattern.split('/').filter(Boolean);
    const b = path.split('/').filter(Boolean);
    return a.length === b.length && a.every((seg, i) => (seg.startsWith('[') ? b[i].length > 0 : seg === b[i]));
  };
  const stageUrl = (path) => {
    const clean = `/${path.split('/').filter(Boolean).join('/')}`;
    const page = pages.find((p) => p.path === clean) || pages.find((p) => p.path.includes('[') && matches(p.path, clean));
    return page ? page.url : clean;
  };
  for (const a of body.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (raw.startsWith('#')) {
      a.setAttribute('target', '_self');
      continue;
    }
    let u;
    try {
      u = new URL(raw, loc.href);
    } catch {
      continue;
    }
    if (u.origin === loc.origin) {
      a.setAttribute('href', stageUrl(u.pathname) + u.hash);
      a.removeAttribute('target');
    } else if (u.protocol.startsWith('http')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const form of body.querySelectorAll('form')) {
    form.removeAttribute('action');
    form.setAttribute('data-bl-form', '');
  }

  // --- Text: every non-blank text node in a span of its own, marked for what it is. --------------
  const LABEL = 'nav, button, label, legend, summary, th, dt, [role="tab"], [role="button"], [role="menuitem"], [role="switch"], [role="option"]';
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() && n.parentElement && !n.parentElement.closest('svg, textarea, select, option, title') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    const parent = node.parentElement;
    let role = 'copy';
    if (parent.closest('h1, h2, h3, h4, h5, h6')) role = 'heading';
    else if (parent.closest(LABEL)) role = 'label';
    else {
      const a = parent.closest('a');
      if (a && !a.closest('p, blockquote') && a.textContent.trim().length <= textRoleLinkMax) role = 'label';
    }
    const span = document.createElement('span');
    span.setAttribute('data-bl-t', role);
    parent.replaceChild(span, node);
    span.appendChild(node);
  }

  const attrs = (el) => Object.fromEntries([...el.attributes].filter((a) => a.name !== 'nonce').map((a) => [a.name, a.value]));
  return {
    title: document.title,
    htmlAttrs: attrs(document.documentElement),
    bodyAttrs: attrs(body),
    body: body.innerHTML,
    styles,
    assets: [...assets],
    rawLinks,
  };
};

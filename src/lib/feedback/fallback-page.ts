import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, FEEDBACK_PATH, MAX_MESSAGE_CHARS } from './constants';

/**
 * The plain form: the reporter with nothing underneath it.
 *
 * The widget (src/components/feedback) is a React component inside the site's layout, styled by the
 * site's stylesheet. This is what the shortcut and the account menu fall back to when any of that is
 * what broke: one HTML document from one route handler, with no script, no stylesheet, no layout,
 * no database and no sign-in lookup. Like `global-error.tsx` it is plain on purpose: browser
 * default type at a readable size, visible labels, one button. It names no colour and no font, so
 * there is nothing here for the design tokens to govern.
 */
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(title)} | Sara + Tyler</title>
</head>
<body style="margin:0;padding:2rem 1rem;font-size:1.0625rem;line-height:1.5;max-width:36rem">
<main id="main">
${body}
</main>
</body>
</html>`;

export function fallbackForm(opts: { from: string; digest?: string; error?: string; message?: string }): string {
  const kinds = FEEDBACK_KINDS.map(
    (kind, i) => `<p><label><input type="radio" name="kind" value="${kind}"${i === 0 ? ' checked' : ''}> ${escape(FEEDBACK_KIND_LABELS[kind])}</label></p>`,
  ).join('\n');
  return page(
    'Report a problem',
    `<h1>Report a problem</h1>
<p>This goes to the site’s to-do list. Say what you saw and what you expected; a screenshot helps.</p>
${opts.error ? `<p role="alert"><strong>${escape(opts.error)}</strong></p>` : ''}
<form method="post" action="${FEEDBACK_PATH}" enctype="multipart/form-data">
<input type="hidden" name="path" value="${escape(opts.from)}">
${opts.digest ? `<input type="hidden" name="digest" value="${escape(opts.digest)}">` : ''}
<fieldset>
<legend>What kind of thing is it?</legend>
${kinds}
</fieldset>
<p><label for="message">What happened?</label><br>
<textarea id="message" name="message" rows="8" maxlength="${MAX_MESSAGE_CHARS}" required style="width:100%;font:inherit;box-sizing:border-box">${escape(opts.message ?? '')}</textarea></p>
<p><label for="screenshot">Screenshot (optional)</label><br>
<input id="screenshot" name="screenshot" type="file" accept="image/png,image/jpeg,image/webp" style="font:inherit"></p>
<p><button type="submit" style="font:inherit;padding:0.5rem 1rem">Send report</button></p>
</form>
${opts.from ? `<p><a href="${escape(opts.from)}">Back to the page</a></p>` : '<p><a href="/">Go to the home page</a></p>'}`,
  );
}

export function fallbackThanks(opts: { ref: string; where: string; from: string }): string {
  return page(
    'Report sent',
    `<h1>Report sent</h1>
<p>${escape(opts.where)}</p>
<p>Reference: ${escape(opts.ref)}</p>
<p><a href="${escape(opts.from || '/')}">Back to the site</a></p>`,
  );
}

/** Only a path on this site: `/rsvp`, never `//elsewhere` or a scheme. */
export function safeFrom(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '';
  return value.split(/[?#]/)[0]!.slice(0, 200);
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ADMIN_SECTIONS } from '@/app/(admin)/admin/_components/sections';
import { AdminIcon, type AdminIconName } from './icons';

/**
 * One box for "take me there" and "tell me". Type part of a screen's name and Enter opens it; type
 * a question and Enter hands it to the assistant. It is a combobox over a listbox inside a modal
 * `<dialog>`, so the browser owns the focus trap, Escape and the return of focus.
 */

type Item = { id: string; label: string; hint: string; group: string; href: string; icon: AdminIconName; words: string };

const SCREENS: Item[] = ADMIN_SECTIONS.flatMap((section) =>
  section.screens.map((screen) => ({
    id: `go-${screen.href}`,
    label: screen.label,
    hint: screen.blurb,
    group: section.label || 'Console',
    href: screen.href,
    icon: screen.icon,
    words: `${screen.label} ${screen.words ?? ''} ${screen.blurb}`.toLowerCase(),
  })),
);

const ACTIONS: Item[] = [
  { id: 'act-view-as', label: 'View the site as a guest role', hint: 'Preview with a role’s access, without a real guest’s record.', group: 'Do', href: '/admin#view-as', icon: 'eye', words: 'view as role preview guest impersonate' },
  { id: 'act-inspect', label: 'Browse as one guest', hint: 'See the site exactly as a person on the list does.', group: 'Do', href: '/admin/guests#inspect-guest', icon: 'guests', words: 'inspect browse as guest profile' },
  { id: 'act-publish', label: 'Publish a lifecycle state', hint: 'Move what every guest sees.', group: 'Do', href: '/admin/lifecycle', icon: 'lifecycle', words: 'publish open rsvp save the date state' },
  { id: 'act-export', label: 'Export RSVPs', hint: 'Replies and meal counts as CSV.', group: 'Do', href: '/admin/rsvp', icon: 'rsvp', words: 'export csv download headcount caterer' },
  { id: 'act-site', label: 'Open the guest site', hint: 'The home page, as you.', group: 'Do', href: '/', icon: 'external', words: 'site home public' },
];

/** Questions the assistant answers from this deployment's own records; shown before anything is typed. */
export const STARTER_QUESTIONS = ['What needs my attention?', 'How many guests have replied?', 'Who visited this week?', 'What errors did guests hit?'] as const;

const askHref = (question: string) => `/admin/assistant?q=${encodeURIComponent(question)}`;

function score(item: Item, tokens: string[]): number {
  const label = item.label.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (label.startsWith(token)) total += 4;
    else if (label.includes(token)) total += 3;
    else if (item.words.includes(token)) total += 1;
    else return 0;
  }
  return total;
}

/** A question rather than a name: it ends in a question mark, opens with a question word, or runs long. */
const looksLikeQuestion = (text: string) => /\?\s*$/.test(text) || /^(who|what|when|where|why|how|which|show|list|did|do|does|is|are|can|plan|compare|count|find|tell)\b/i.test(text) || text.trim().split(/\s+/).length > 3;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      input.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const text = query.trim();
    if (!text) {
      const starters: Item[] = STARTER_QUESTIONS.map((q, i) => ({ id: `ask-${i}`, label: q, hint: '', group: 'Ask', href: askHref(q), icon: 'ask', words: '' }));
      return [...starters, ...SCREENS];
    }
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    // Best match first, under one heading: results ranked by score would otherwise repeat their
    // section headings every other row.
    const matches = [...SCREENS, ...ACTIONS]
      .map((item) => ({ item, s: score(item, tokens) }))
      .filter((m) => m.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((m) => ({ ...m.item, group: 'Go to' }));
    const ask: Item = { id: 'ask-typed', label: `Ask: ${text}`, hint: 'Answered from this site’s own records.', group: 'Ask', href: askHref(text), icon: 'ask', words: '' };
    // A question goes to the assistant first; a name goes to its screen first, with asking one arrow away.
    return looksLikeQuestion(text) || matches.length === 0 ? [ask, ...matches] : [...matches, ask];
  }, [query]);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  /** Closing clears the box, so the next open starts from the list, not from the last search. */
  const close = () => {
    setQuery('');
    setActive(0);
    onClose();
  };

  const go = (item: Item | undefined) => {
    if (!item) return;
    close();
    router.push(item.href);
  };

  let lastGroup = '';

  return (
    <dialog
      ref={dialog}
      className="adm-palette"
      aria-label="Jump to a screen or ask a question"
      onClose={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="adm-palette__box">
        <div className="adm-palette__field">
          <AdminIcon name="search" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Jump to a screen or ask a question"
            placeholder="A screen, a guest question, a number you need"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (event.key === 'Home') {
                event.preventDefault();
                setActive(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                setActive(items.length - 1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(items[active]);
              }
            }}
          />
          <kbd className="adm-kbd" aria-hidden="true">
            Esc
          </kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="adm-palette__list">
          {items.map((item, i) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading ? (
                  <p className="adm-palette__group" aria-hidden="true">
                    {heading}
                  </p>
                ) : null}
                {/* Options are picked with the arrow keys from the field, so they are not tab stops. */}
                <div id={`${listId}-${i}`} role="option" aria-selected={i === active} className="adm-palette__item" onPointerMove={() => setActive(i)} onClick={() => go(item)}>
                  <AdminIcon name={item.icon} className="adm-palette__icon" />
                  <span className="adm-palette__label">{item.label}</span>
                  {item.hint ? <span className="adm-palette__hint">{item.hint}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="adm-palette__foot" aria-hidden="true">
          <span>
            <kbd className="adm-kbd">
              <AdminIcon name="up" />
            </kbd>
            <kbd className="adm-kbd">
              <AdminIcon name="down" />
            </kbd>{' '}
            to move
          </span>
          <span>
            <kbd className="adm-kbd">Enter</kbd> to open
          </span>
        </p>
      </div>
    </dialog>
  );
}

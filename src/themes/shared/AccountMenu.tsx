'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SIGN_IN, SIGN_OUT } from '@/domain/lifecycle/account';
import type { NavItem, NavModel } from '@/themes/types';

/**
 * The account menu: "Sign in" to anyone, and — once there is a session — the household's own pages
 * (RSVP, Your Weekend, Transportation, Gifts, Photos & Video) followed by "Sign out". Those pages are
 * listed here and nowhere else in the chrome (`domain/lifecycle/nav.ts` keeps them out of `primary`,
 * `more` and `sticky`), and each of them refuses an anonymous request on the server regardless.
 *
 * Public pages are prerendered per design and cannot know who is reading, so when the frame leaves
 * `signedIn` undefined the menu asks `/api/session` once per page load (every instance shares the
 * one request) and opens itself on a yes. Until the answer arrives — and with JavaScript off — it is
 * the plain "Sign in" link, which is the right door for everyone: `/sign-in` sends a reader who
 * already has a session on to their weekend.
 *
 * Three placements, one component:
 * - `popover`: masthead and rail. A disclosure button ("Your account") and a panel of links; the
 *   WAI disclosure-navigation pattern, not an ARIA `menu` — these are links, and Tab moves through
 *   them. Escape closes and returns focus; leaving the panel or clicking elsewhere closes it.
 * - `inline`: the Menu sheet. The sheet is already the opened menu, so the pages sit in a labelled
 *   group under the site's pages with nothing more to open.
 * - `link`: the footer. "Sign in" or "Sign out".
 */

const TRIGGER_LABEL = 'Your account';

let probe: Promise<boolean> | null = null;

/**
 * One request per page, whichever instance asks first. Only an answer is kept: a failed request
 * reads as signed out for now and is forgotten, so the next instance (or the next page) asks again
 * rather than showing "Sign in" to a signed-in guest for the rest of the visit.
 */
function sessionProbe(fresh = false): Promise<boolean> {
  if (fresh) probe = null;
  if (probe) return probe;
  const asked = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } }).then(async (r) => {
    if (!r.ok) throw new Error(`session probe: ${r.status}`);
    return ((await r.json()) as { signedIn?: unknown }).signedIn === true;
  });
  probe = asked;
  return asked.catch(() => {
    if (probe === asked) probe = null;
    return false;
  });
}

function useSignedIn(known: boolean | undefined): boolean {
  const [probed, setProbed] = useState(false);
  // A page restored from the back/forward cache kept the menu it had when it was left — after a
  // sign-out in between, that is a menu of pages the reader can no longer open. Ask again then,
  // whatever the server knew when it rendered.
  const [restored, setRestored] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (known === undefined) {
      void sessionProbe().then((v) => {
        if (live) setProbed(v);
      });
    }
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      void sessionProbe(true).then((v) => {
        if (live) setRestored(v);
      });
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      live = false;
      window.removeEventListener('pageshow', onShow);
    };
  }, [known]);
  return restored ?? known ?? probed;
}

export interface AccountMenuClassNames {
  /** The "Sign in" / "Sign out" link, and the `popover` trigger. */
  link: string;
  /** Each page link inside the menu. */
  item: string;
  /** The `inline` group's label. */
  label?: string;
}

export interface AccountMenuProps {
  nav: Pick<NavModel, 'account' | 'member' | 'signedIn' | 'currentPath'>;
  variant: 'popover' | 'inline' | 'link';
  classNames: AccountMenuClassNames;
}

export function AccountMenu({ nav, variant, classNames }: AccountMenuProps) {
  const signedIn = useSignedIn(nav.signedIn);
  const signIn = nav.account ?? SIGN_IN;
  if (!signedIn) {
    return (
      <a className={classNames.link} href={signIn.href} aria-current={nav.currentPath === signIn.href ? 'page' : undefined}>
        {signIn.label}
      </a>
    );
  }
  if (variant === 'link') {
    return (
      <a className={classNames.link} href={SIGN_OUT.href}>
        {SIGN_OUT.label}
      </a>
    );
  }
  const items = [...(nav.member ?? []), SIGN_OUT];
  if (variant === 'inline') return <InlineGroup items={items} currentPath={nav.currentPath} classNames={classNames} />;
  return <Popover items={items} currentPath={nav.currentPath} classNames={classNames} />;
}

function ItemList({ items, currentPath, className, onPick }: { items: NavItem[]; currentPath: string; className: string; onPick?: () => void }) {
  return (
    <ul className="account-menu__list">
      {items.map((item) => (
        <li key={item.href}>
          <a className={className} href={item.href} aria-current={item.href === currentPath ? 'page' : undefined} onClick={onPick}>
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function InlineGroup({ items, currentPath, classNames }: { items: NavItem[]; currentPath: string; classNames: AccountMenuClassNames }) {
  const labelId = useId();
  return (
    <div className="account-menu account-menu--inline" role="group" aria-labelledby={labelId}>
      <p id={labelId} className={`account-menu__label${classNames.label ? ` ${classNames.label}` : ''}`}>
        {TRIGGER_LABEL}
      </p>
      <ItemList items={items} currentPath={currentPath} className={classNames.item} />
    </div>
  );
}

function Popover({ items, currentPath, classNames }: { items: NavItem[]; currentPath: string; classNames: AccountMenuClassNames }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  const current = items.some((i) => i.href === currentPath);
  return (
    <div
      ref={root}
      className="account-menu account-menu--popover"
      onBlur={(e) => {
        if (open && root.current && e.relatedTarget instanceof Node && !root.current.contains(e.relatedTarget)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`account-menu__trigger ${classNames.link}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-current={current ? 'true' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {TRIGGER_LABEL}
      </button>
      <div id={panelId} className="account-menu__panel" hidden={!open}>
        <ItemList items={items} currentPath={currentPath} className={classNames.item} onPick={() => setOpen(false)} />
      </div>
    </div>
  );
}

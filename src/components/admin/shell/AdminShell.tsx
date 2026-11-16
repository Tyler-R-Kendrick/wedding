'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ADMIN_SECTIONS, screenFor } from '@/app/(admin)/admin/_components/sections';
import { CommandPalette } from './CommandPalette';
import { AdminIcon } from './icons';
import './shell.css';

/**
 * The console's frame: a rail that reaches every screen in one click, a bar that says where you are
 * and takes a search or a question, and the screen itself.
 *
 * The rail is one element at every width. On a phone it sits off-canvas and is `inert` until the
 * menu button opens it, so a keyboard never tabs through twenty-six links it cannot see; Escape and
 * the scrim close it, and focus returns to the button that opened it.
 */
export function AdminShell({ role, children }: { role: string; children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const here = screenFor(pathname);
  const [railOpen, setRailOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLElement>(null);

  // The rail is a drawer only below the breakpoint the stylesheet uses (60rem).
  useEffect(() => {
    const query = window.matchMedia('(width < 60rem)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const closeRail = useCallback(() => {
    setRailOpen(false);
    menuButton.current?.focus();
  }, []);

  useEffect(() => {
    if (!railOpen) return;
    rail.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen, closeRail]);

  // Ctrl/⌘ K from anywhere; "/" when the keyboard is not already in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const railHidden = narrow && !railOpen;

  return (
    <div className="adm" data-rail={railOpen ? 'open' : 'closed'}>
      <a className="skip" href="#main">
        Skip to content
      </a>

      {/* A tap on a link closes the drawer: the link is the answer to why it was opened. */}
      <aside
        ref={rail}
        className="adm-rail"
        id="admin-rail"
        inert={railHidden || undefined}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a')) setRailOpen(false);
        }}
      >
        <div className="adm-brand">
          <Link href="/admin" className="adm-brand__name">
            Sara + Tyler
          </Link>
          <span className="adm-brand__role">{role}</span>
          <button type="button" className="adm-icon-button adm-rail__close" onClick={closeRail} aria-label="Close the menu">
            <AdminIcon name="close" />
          </button>
        </div>
        <nav aria-label="Admin" className="adm-nav">
          {ADMIN_SECTIONS.map((section) => (
            <div key={section.id} className="adm-nav__group" role="group" aria-labelledby={section.label ? `rail-${section.id}` : undefined}>
              {section.label ? (
                <p id={`rail-${section.id}`} className="adm-nav__label">
                  {section.label}
                </p>
              ) : null}
              <ul className="adm-nav__list">
                {section.screens.map((screen) => (
                  <li key={screen.href}>
                    <Link href={screen.href} className="adm-nav__link" aria-current={here?.screen.href === screen.href ? 'page' : undefined}>
                      <AdminIcon name={screen.icon} className="adm-nav__icon" />
                      <span>{screen.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="adm-rail__foot">
          <Link href="/admin#view-as" className="adm-nav__link">
            <AdminIcon name="eye" className="adm-nav__icon" />
            <span>View as a guest</span>
          </Link>
          <Link href="/" className="adm-nav__link">
            <AdminIcon name="external" className="adm-nav__icon" />
            <span>Open the site</span>
          </Link>
        </div>
      </aside>
      {railOpen ? <button type="button" className="adm-scrim" aria-label="Close the menu" tabIndex={-1} onClick={closeRail} /> : null}

      <div className="adm-main">
        <header className="adm-bar">
          <button ref={menuButton} type="button" className="adm-icon-button adm-bar__menu" onClick={() => setRailOpen(true)} aria-label="Open the menu" aria-expanded={railOpen} aria-controls="admin-rail">
            <AdminIcon name="menu" />
          </button>
          <p className="adm-bar__where">
            {here?.section.label ? <span className="adm-bar__section">{here.section.label}</span> : null}
            <span className="adm-bar__screen">{here?.screen.label ?? 'Admin'}</span>
          </p>
          {/* "Jump to", not "Search": most screens have their own Search button, and two buttons that
              answer to one name is a trap for a screen reader's list of buttons. */}
          <button type="button" className="adm-search" onClick={() => setPaletteOpen(true)} aria-label="Jump to a screen or ask a question" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
            <AdminIcon name="search" />
            <span className="adm-search__label">Jump to or ask</span>
            <kbd className="adm-kbd" aria-hidden="true">
              Ctrl K
            </kbd>
          </button>
          <Link href="/admin/assistant" className="adm-ask" aria-current={pathname === '/admin/assistant' ? 'page' : undefined}>
            <AdminIcon name="ask" />
            <span>Ask</span>
          </Link>
        </header>
        {children}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

import Link from 'next/link';

/** Sub-navigation for the intelligence admin pages. */
export function AdminAiNav({ current }: { current: 'ai' | 'biometrics' | 'concierge' }) {
  const items: { key: typeof current; href: string; label: string }[] = [
    { key: 'ai', href: '/admin/ai', label: 'Search index' },
    { key: 'biometrics', href: '/admin/biometrics', label: 'Face matching' },
    { key: 'concierge', href: '/admin/concierge', label: 'Concierge' },
  ];
  return (
    <nav aria-label="Intelligence admin" className="mi-nav">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={`media-button ${i.key === current ? '' : 'media-button--secondary'}`} aria-current={i.key === current ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

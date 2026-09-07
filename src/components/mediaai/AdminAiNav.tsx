import Link from 'next/link';

/** Sub-navigation for the intelligence admin pages. */
export function AdminAiNav({ current }: { current: 'ai' | 'biometrics' }) {
  const items: { key: typeof current; href: string; label: string }[] = [
    { key: 'ai', href: '/admin/ai', label: 'Search index' },
    { key: 'biometrics', href: '/admin/biometrics', label: 'Face matching' },
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

import Link from 'next/link';

/** Sub-navigation shared by the admin media pages (queue, duplicates, import, storage). */
export function AdminMediaNav({ current }: { current: 'queue' | 'duplicates' | 'import' | 'metrics' }) {
  const items: { key: typeof current; href: string; label: string }[] = [
    { key: 'queue', href: '/admin/media', label: 'Queue' },
    { key: 'duplicates', href: '/admin/media/duplicates', label: 'Duplicates' },
    { key: 'import', href: '/admin/media/import', label: 'Import professional media' },
    { key: 'metrics', href: '/admin/media/metrics', label: 'Storage and cost' },
  ];
  return (
    <nav aria-label="Media admin" className="media-actions">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={`media-button ${i.key === current ? '' : 'media-button--secondary'}`} aria-current={i.key === current ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function AdminGate() {
  return (
    <main id="main" className="media-page">
      <h1>Admin</h1>
      <p>Administrator sign-in is required.</p>
    </main>
  );
}

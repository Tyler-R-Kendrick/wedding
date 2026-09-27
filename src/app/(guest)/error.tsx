'use client';

import { PageError } from '@/components/errors/PageError';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError error={error} reset={reset} />;
}

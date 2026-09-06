import type { ReactNode } from 'react';
import './auth.css';

export const metadata = { robots: { index: false, follow: false } };

/** Auth journeys share one narrow, calm shell. Personalized: never cached. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}

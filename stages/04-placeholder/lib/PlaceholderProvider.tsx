'use client';

import { ContentProvider } from '@wedding/skeleton';
import type { ReactNode } from 'react';
import { placeholderFor } from './placeholder';

/** Answers every slot of the stage 3 tree with placeholder copy, so the bones give way to text. */
export function PlaceholderProvider({ children }: { children: ReactNode }) {
  return <ContentProvider resolve={placeholderFor}>{children}</ContentProvider>;
}

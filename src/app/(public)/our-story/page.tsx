import type { Metadata } from 'next';
import { StoryView } from '../_views';

export const metadata: Metadata = { title: 'Our Story' };

/** For a reader with a session; anyone else is served the prerendered copy (src/themes/routes.ts). */
export default function OurStoryPage() {
  return <StoryView reader="request" />;
}

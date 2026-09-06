import type { LifecycleView } from '@/themes/types';

/** Admin preview is always visibly banded (ADR-0012 §3). */
export function PreviewBanner({ lifecycle }: { lifecycle: LifecycleView }) {
  if (!lifecycle.preview) return null;
  return (
    <div className="preview-band" role="status">
      Previewing <strong>{lifecycle.preview.state}</strong> (published state: {lifecycle.persistedState}). Nothing is changed for guests.
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryItem, MediaItemDetail } from '@/capabilities/media';
import { callCapability } from './capabilityClient';
import { formatDuration } from './MediaShell';

/**
 * Grid + native <dialog> lightbox: focus trap, Esc, and focus return come from the platform.
 * Video playback links are fetched when the item opens (get_media_item) because they expire.
 */
export function Lightbox({ items }: { items: GalleryItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<MediaItemDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const show = useCallback((index: number, opener?: HTMLElement) => {
    if (opener) openerRef.current = opener;
    setOpen(index);
    setDetail(null);
    setDetailError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    setDetail(null);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open !== null && !dialog.open) dialog.showModal();
    if (open === null && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const item = items[open];
    if (!item) return;
    let cancelled = false;
    void callCapability<MediaItemDetail>('get_media_item', { assetId: item.id }).then((r) => {
      if (cancelled) return;
      if (r.ok) setDetail(r.data);
      else setDetailError(r.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open, items]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : Math.min(items.length - 1, i + 1)));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items.length]);

  const current = open !== null ? items[open] : undefined;
  const full = detail?.gallery ?? current?.gallery ?? null;

  return (
    <>
      <ul className="media-grid" data-testid="gallery-grid">
        {items.map((item, index) => {
          const alt = item.altText ?? item.caption ?? (item.kind === 'video' ? `Video ${index + 1}` : `Photo ${index + 1}`);
          const badge = item.kind === 'video' ? `Video${formatDuration(item.durationSeconds) ? ` · ${formatDuration(item.durationSeconds)}` : ''}` : null;
          const w = item.thumb?.width ?? item.width ?? 4;
          const h = item.thumb?.height ?? item.height ?? 3;
          return (
            <li key={item.id}>
              <button type="button" className="media-tile" style={{ aspectRatio: `${w} / ${h}` }} onClick={(e) => show(index, e.currentTarget)} aria-label={`Open ${alt}`} data-asset-id={item.id}>
                {item.thumb ? (
                  <img src={item.thumb.url} alt={alt} width={w} height={h} loading={index < 8 ? 'eager' : 'lazy'} decoding="async" />
                ) : (
                  <span className="media-tile__placeholder">Preparing</span>
                )}
                {badge ? <span className="media-tile__badge">{badge}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <dialog ref={dialogRef} className="media-lightbox" aria-label={current ? (current.caption ?? (current.kind === 'video' ? 'Video' : 'Photo')) : 'Media'} onClose={close} onCancel={(e) => { e.preventDefault(); close(); }}>
        {current ? (
          <div className="media-lightbox__inner">
            <div className="media-lightbox__bar">
              <span>
                {open! + 1} of {items.length}
              </span>
              <div className="media-actions">
                <button type="button" className="media-button" onClick={() => setOpen((i) => (i === null ? i : Math.max(0, i - 1)))} disabled={open === 0} aria-label="Previous">
                  Previous
                </button>
                <button type="button" className="media-button" onClick={() => setOpen((i) => (i === null ? i : Math.min(items.length - 1, i + 1)))} disabled={open === items.length - 1} aria-label="Next">
                  Next
                </button>
                <button type="button" className="media-button" onClick={close} aria-label="Close">
                  Close
                </button>
              </div>
            </div>
            <div className="media-lightbox__stage">
              {current.kind === 'video' ? (
                detail?.video?.playbackUrl ? (
                  <video controls playsInline preload="metadata" poster={detail.video.posterUrl ?? full?.url} src={detail.video.playbackUrl} width={current.width ?? undefined} height={current.height ?? undefined}>
                    <track kind="captions" />
                  </video>
                ) : (
                  <img src={full?.url ?? current.thumb?.url} alt={current.altText ?? current.caption ?? 'Video poster'} width={full?.width ?? undefined} height={full?.height ?? undefined} />
                )
              ) : (
                <img src={full?.url ?? current.thumb?.url} alt={current.altText ?? current.caption ?? 'Photo'} width={full?.width ?? undefined} height={full?.height ?? undefined} />
              )}
            </div>
            <div className="media-lightbox__caption">
              {current.caption ? <p>{current.caption}</p> : null}
              {current.kind === 'video' && detail?.video && !detail.video.playbackUrl ? <p>{detail.video.status === 'preparing' ? 'This video is still being prepared.' : 'Playback is not available right now.'}</p> : null}
              {detailError ? <p>{detailError}</p> : null}
              {(detail?.credit ?? current.credit) ? <p className="media-lightbox__credit">{detail?.credit ?? current.credit}</p> : null}
              {detail?.licenseNote ? <p className="media-lightbox__credit">{detail.licenseNote}</p> : null}
              {detail?.webFull ? (
                <p>
                  <a className="media-link" href={detail.webFull.url} download>
                    Download full size
                  </a>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

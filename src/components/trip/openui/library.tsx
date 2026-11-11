'use client';

import './no-devtools';
import { createLibrary, Renderer, type ActionEvent } from '@openuidev/react-lang';
import { useCallback } from 'react';
import type { Day, Part } from '@/domain/trip-planner';
import '../trip.css';
import { blocks, tripActions } from './blocks';
import { useTripPlanner, type TripAction } from './context';
import { tripFunctions } from './functions';
import { MapMarker, MapView } from './map';
import { primitives } from './primitives';

/**
 * The site's OpenUI library: what a Your Trip answer may be built from. The composer in
 * src/domain/trip-planner/compose.ts writes programs against exactly these names and arguments.
 */
export const tripLibrary = createLibrary({
  root: 'Col',
  components: [...primitives, MapView, MapMarker, ...blocks],
  functions: tripFunctions,
  actions: tripActions,
});

const isDay = (v: unknown): v is Day => v === 'fri' || v === 'sat' || v === 'sun';
const isPart = (v: unknown): v is Part => v === 'morning' || v === 'afternoon' || v === 'evening';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** An action from a rendered answer, checked and typed for the page. Null for anything else. */
export function tripActionOf(event: ActionEvent): TripAction | null {
  const p = (event.params ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'AddToWeekend': {
      const id = str(p.id);
      return id ? { type: 'AddToWeekend', id, ...(isDay(p.day) ? { day: p.day } : {}), ...(isPart(p.part) ? { part: p.part } : {}) } : null;
    }
    case 'RemoveFromWeekend': {
      const id = str(p.id);
      return id ? { type: 'RemoveFromWeekend', id } : null;
    }
    case 'SetWeekend': {
      const items = (Array.isArray(p.items) ? p.items : []).flatMap((raw) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        const id = str(it.id);
        return id && isDay(it.day) && isPart(it.part) ? [{ id, day: it.day, part: it.part }] : [];
      });
      return items.length ? { type: 'SetWeekend', items } : null;
    }
    case 'ConfirmWeekend':
      return { type: 'ConfirmWeekend' };
    case 'ExportCalendar':
      return { type: 'ExportCalendar' };
    case 'continue_conversation': {
      const message = str(p.message) ?? str(event.humanFriendlyMessage);
      return message ? { type: 'Ask', message, ...(p.context !== undefined ? { context: p.context } : {}) } : null;
    }
    default:
      return null;
  }
}

/** One answer, rendered with the trip library; its actions go to the provider's `onAction`. */
export function TripRenderer({ response, isStreaming = false, onError }: { response: string | null; isStreaming?: boolean; onError?: Parameters<typeof Renderer>[0]['onError'] }) {
  const ctx = useTripPlanner();
  const onAction = ctx?.onAction;
  const handle = useCallback(
    (event: ActionEvent) => {
      const action = tripActionOf(event);
      if (action && onAction) onAction(action);
    },
    [onAction],
  );
  return <Renderer response={response} library={tripLibrary} isStreaming={isStreaming} onAction={handle as never} onError={onError} />;
}

/** Hands the guest a calendar file: a Blob behind a temporary link, clicked once and removed. */
export function downloadIcs(text: string, filename = 'our-wedding-weekend.ics'): void {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers start the download after the click returns; release the URL a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

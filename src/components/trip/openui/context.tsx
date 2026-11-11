'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { arrivalFacts, stayFacts, type ArrivalFacts, type Day, type Part, type PlannerPlace, type SavedItem, type StayFacts } from '@/domain/trip-planner';

/**
 * What the page hands the planner's components: the couple's places, the guest's saved weekend,
 * the hotel (for the map and the room block), the arrival facts, and one handler for every action
 * an answer can take. The components read it; only the page changes it.
 */

/** Everything an answer can ask the page to do, already checked and typed. */
export type TripAction =
  | { type: 'AddToWeekend'; id: string; day?: Day; part?: Part }
  | { type: 'RemoveFromWeekend'; id: string }
  | { type: 'SetWeekend'; items: { id: string; day: Day; part: Part }[] }
  | { type: 'ConfirmWeekend' }
  | { type: 'ExportCalendar' }
  | { type: 'Ask'; message: string; context?: unknown };

export type TripHotel = { name: string; lat: number; lng: number };

export type TripPlannerValue = {
  places: ReadonlyMap<string, PlannerPlace>;
  saved: readonly SavedItem[];
  hotel: TripHotel | null;
  stay: StayFacts;
  arrival: ArrivalFacts;
  onAction: (action: TripAction) => void;
};

const TripPlannerContext = createContext<TripPlannerValue | null>(null);

export type TripPlannerProviderProps = {
  places: ReadonlyMap<string, PlannerPlace>;
  saved: readonly SavedItem[];
  /** The wedding hotel's name and coordinates, for the map. */
  hotel?: TripHotel | null;
  /** The room block (defaults to the travel domain's confirmed block). */
  stay?: StayFacts;
  /** Airports and parking (defaults to the travel domain's facts). */
  arrival?: ArrivalFacts;
  onAction: (action: TripAction) => void;
  children: ReactNode;
};

export function TripPlannerProvider({ places, saved, hotel = null, stay, arrival, onAction, children }: TripPlannerProviderProps) {
  const value = useMemo<TripPlannerValue>(
    () => ({ places, saved, hotel, stay: stay ?? stayFacts(), arrival: arrival ?? arrivalFacts(), onAction }),
    [places, saved, hotel, stay, arrival, onAction],
  );
  return <TripPlannerContext.Provider value={value}>{children}</TripPlannerContext.Provider>;
}

/** The planner's context. Outside a provider, components render nothing rather than guessing. */
export function useTripPlanner(): TripPlannerValue | null {
  return useContext(TripPlannerContext);
}

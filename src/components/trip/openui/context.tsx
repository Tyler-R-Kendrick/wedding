'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { arrivalFacts, stayFacts, type ArrivalFacts, type CalendarDayModel, type Day, type Diet, type Meal, type Part, type PlannerPlace, type SavedItem, type StayFacts } from '@/domain/trip-planner';
import type { TripProfile } from '@/domain/trip-planner/profile';

/**
 * What the page hands the planner's components: the couple's places, the guest's saved weekend,
 * the hotel (for the map and the room block), the arrival facts, and one handler for every action
 * an answer can take. The components read it; only the page changes it.
 */

/** Everything an answer can ask the page to do, already checked and typed. */
export type TripAction =
  | { type: 'AddToWeekend'; id: string; day?: Day; part?: Part }
  | { type: 'RemoveFromWeekend'; id: string }
  /** Something of the guest's own ("Busy", "Dinner with my parents"), written into a part of a weekend day. */
  | { type: 'AddOwn'; title: string; day: Day; part: Part; date?: string }
  /** The guest's answer to what was asked before a meal: the request is then answered with it. */
  | { type: 'AnswerClarify'; request: string; diet: Diet[]; meal: Meal | null }
  /** Open My plans with this saved place picked up, ready to be given another time. */
  | { type: 'MovePlan'; id: string }
  | { type: 'OpenPlans' }
  | { type: 'SetWeekend'; items: { id: string; day: Day; part: Part }[] }
  | { type: 'ConfirmWeekend' }
  | { type: 'ExportCalendar' }
  | { type: 'Ask'; message: string; context?: unknown };

export type TripHotel = { name: string; lat: number; lng: number };

export type TripPlannerValue = {
  places: ReadonlyMap<string, PlannerPlace>;
  saved: readonly SavedItem[];
  /** The time the guest is finding something for ("Add" on a part of a day): places are added there. */
  target: { date: string; part: Part } | null;
  /** The guest's plans as they are now, so a summary of them in an old answer is never out of date. */
  calendar: readonly CalendarDayModel[] | null;
  hotel: TripHotel | null;
  stay: StayFacts;
  arrival: ArrivalFacts;
  /** Who the planner plans for, so a place can say what matters to them. Null: nothing is known. */
  profile: TripProfile | null;
  onAction: (action: TripAction) => void;
};

const TripPlannerContext = createContext<TripPlannerValue | null>(null);

export type TripPlannerProviderProps = {
  places: ReadonlyMap<string, PlannerPlace>;
  saved: readonly SavedItem[];
  target?: { date: string; part: Part } | null;
  calendar?: readonly CalendarDayModel[] | null;
  /** The wedding hotel's name and coordinates, for the map. */
  hotel?: TripHotel | null;
  /** The room block (defaults to the travel domain's confirmed block). */
  stay?: StayFacts;
  /** Airports and parking (defaults to the travel domain's facts). */
  arrival?: ArrivalFacts;
  profile?: TripProfile | null;
  onAction: (action: TripAction) => void;
  children: ReactNode;
};

export function TripPlannerProvider({ places, saved, target = null, calendar = null, hotel = null, stay, arrival, profile = null, onAction, children }: TripPlannerProviderProps) {
  const value = useMemo<TripPlannerValue>(
    () => ({ places, saved, target, calendar, hotel, stay: stay ?? stayFacts(), arrival: arrival ?? arrivalFacts(), profile, onAction }),
    [places, saved, target, calendar, hotel, stay, arrival, profile, onAction],
  );
  return <TripPlannerContext.Provider value={value}>{children}</TripPlannerContext.Provider>;
}

/** The planner's context. Outside a provider, components render nothing rather than guessing. */
export function useTripPlanner(): TripPlannerValue | null {
  return useContext(TripPlannerContext);
}

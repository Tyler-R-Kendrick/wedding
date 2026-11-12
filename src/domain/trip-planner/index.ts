/**
 * The Your Trip planner: request → intent → deterministic plan → (optional) written words → an
 * OpenUI Lang program, and the guest's weekend as a calendar file. Pure TypeScript: no React, no DOM.
 */
export * from './types';
export { understand } from './intent';
export { outsideQueryFor, pickOutside, dietPhrase } from './outside';
export { draftPlan, scorePlaces, safeSlot, fitIn, clearHit, MAX_PICKS, MAX_CANDIDATES, CLEAR_HIT_MARGIN } from './draft';
export { matchItinerary, itineraryScore, itineraryStarter, usableItinerary } from './itineraries';
export { writerPrompt, mergeWritten } from './writer';
export { compose, placesIn, str as openuiString } from './compose';
export { planRoute, legBetween, kmBetween, stopMinutes, routeFacts, minutesRange, clockTime, clockSpan, aboutHowLong, orderByNearest, fitToPart, PART_START, PART_LENGTH, type Leg, type LegMode, type RoutePlan, type RouteStop } from './route';
export { buildIcs, wallTime, calendarModel, weddingEntries, planEntries, tripEntries, blockEntries, staysInBlock, eventTime, settledText, escapeText, foldLine, vtimezone, TIME_TBA, DETAILS_TBC, type TripItemInput } from './ics';
export { scheduleOf, blockDateLines, timeText, type ScheduleItem } from './schedule';
export { stayFacts, arrivalFacts, weekendDate, dateLabel, isWeddingTime, addDays, dayOfDate, savedDate, onWeekend, slotForDate, stayDays, slotName, STAY_MAX_DAYS, PART_HOURS, DAY_NAME, PLANNER_TIMEZONE, type StayFacts, type ArrivalFacts } from './facts';
export { knowBeforeYouGo, type Know } from './know';
export { profileOf, readPrefs, prefsOf, withPrefs, profileSummary, profileStarters, type TripProfile, type TripPrefs, type TripRecords } from './profile';

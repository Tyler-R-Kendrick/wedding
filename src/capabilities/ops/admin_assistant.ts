import { z } from 'zod';
import { ADMIN_SCREENS } from '@/app/(admin)/admin/_components/sections';
import { defineCapability, type CapabilityContext } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { VIEW_NAMES, compose, route, type Gathered, type Intent } from '@/domain/admin-assistant';
import { invoke } from '../invoke';
import { registry } from '../registry';

const input = z.object({
  message: z.string().trim().min(1).max(500),
  /**
   * What the page already knows about the question: the view the browser's model chose when the
   * router could not tell, or a follow-up's own arguments. It selects which records are read, and
   * nothing else — it cannot name a capability, and every read below is authorized on its own.
   */
  choice: z
    .object({
      view: z.enum(VIEW_NAMES).optional(),
      window: z.union([z.literal(24), z.literal(168), z.literal(720)]).optional(),
      subject: z.string().trim().max(60).optional(),
      sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/).optional(),
    })
    .optional(),
});

const output = z.object({
  view: z.enum(VIEW_NAMES),
  /** False when the router could not tell what was asked and answered with the list of things it can do. */
  understood: z.boolean(),
  title: z.string(),
  summary: z.string(),
  program: z.string(),
  facts: z.array(z.string()),
  next: z.array(z.string()),
  /** The window the answer was read for, in hours, when it has one. */
  window: z.number().int().nullable(),
  /** Which records were read for this answer, and whether this administrator may read them. */
  read: z.array(z.object({ tool: z.string(), title: z.string(), ok: z.boolean() })),
});
export type AssistantAnswer = z.infer<typeof output>;

/** Runs one read capability for the caller through the pipeline; a refusal or a miss is `null`. */
type Trace = { tool: string; title: string; ok: boolean }[];
const traces = new WeakMap<CapabilityContext, Trace>();

async function read<T>(ctx: CapabilityContext, name: string, args: unknown): Promise<T | null> {
  const capability = registry.get(name);
  if (!capability) return null;
  const result = await invoke(capability, ctx, args);
  traces.get(ctx)?.push({ tool: name, title: capability.title, ok: result.ok });
  return result.ok ? (result.value.data as T) : null;
}

/** The records an intent needs, and no others. */
async function gather(ctx: CapabilityContext, intent: Intent): Promise<Gathered> {
  const g: Gathered = { now: ctx.now.toISOString() };
  const windowHours = intent.window ?? 168;
  switch (intent.view) {
    case 'attention':
      [g.lifecycle, g.jobs, g.rsvp, g.errors, g.traffic] = await Promise.all([
        read<Gathered['lifecycle']>(ctx, 'admin_lifecycle_status', { historyLimit: 1 }),
        read<Gathered['jobs']>(ctx, 'admin_jobs_overview', { attentionLimit: 10, recentLimit: 1 }),
        read<Gathered['rsvp']>(ctx, 'admin_rsvp_overview', {}),
        read<Gathered['errors']>(ctx, 'admin_site_errors', { windowHours: 168 }),
        read<Gathered['traffic']>(ctx, 'admin_site_traffic', { windowHours: 168 }),
      ]);
      break;
    case 'traffic':
      g.traffic = await read(ctx, 'admin_site_traffic', { windowHours });
      break;
    case 'sessions':
      g.sessions = await read(ctx, 'admin_list_sessions', { windowHours, limit: 50, ...(intent.withErrors ? { withErrors: true } : {}) });
      break;
    case 'session':
      g.session = intent.sessionId ? await read(ctx, 'admin_session_detail', { sessionId: intent.sessionId }) : null;
      break;
    case 'errors':
      [g.errors, g.traffic] = await Promise.all([read<Gathered['errors']>(ctx, 'admin_site_errors', { windowHours }), read<Gathered['traffic']>(ctx, 'admin_site_traffic', { windowHours })]);
      break;
    case 'rsvp':
    case 'pending':
      g.rsvp = await read(ctx, 'admin_rsvp_overview', {});
      break;
    case 'guest': {
      // The guest list searches one field at a time, so "Ada Testhouse" matches no first name and
      // no last name. Each word is searched on its own and the guests who match the most words win.
      const words = (intent.subject ?? '').split(/\s+/).filter((w) => w.length > 1).slice(0, 3);
      type Found = NonNullable<Gathered['guests']>[number] & { mergedIntoGuestId?: string | null };
      const lists = await Promise.all(words.map((q) => read<{ guests: Found[] }>(ctx, 'admin_list_guests', { q, limit: 20 })));
      if (lists.some((l) => l === null)) g.guests = null;
      else {
        const byId = new Map<string, { guest: Found; hits: number }>();
        for (const list of lists) for (const guest of list!.guests) if (!guest.mergedIntoGuestId) byId.set(guest.id, { guest, hits: (byId.get(guest.id)?.hits ?? 0) + 1 });
        const best = Math.max(0, ...[...byId.values()].map((m) => m.hits));
        g.guests = [...byId.values()].filter((m) => m.hits === best).map((m) => m.guest).slice(0, 5);
      }
      if (g.guests?.length === 1) {
        [g.sessions, g.rsvp] = await Promise.all([read<Gathered['sessions']>(ctx, 'admin_list_sessions', { windowHours: 720, limit: 50, guestId: g.guests[0]!.id }), read<Gathered['rsvp']>(ctx, 'admin_rsvp_overview', {})]);
      } else if (g.guests && g.guests.length > 1) {
        g.rsvp = await read(ctx, 'admin_rsvp_overview', {});
      }
      break;
    }
    case 'lifecycle':
      g.lifecycle = await read(ctx, 'admin_lifecycle_status', { historyLimit: 1 });
      break;
    case 'jobs':
      g.jobs = await read(ctx, 'admin_jobs_overview', { attentionLimit: 10, recentLimit: 1 });
      break;
    case 'metrics':
      g.metrics = await read(ctx, 'admin_ops_metrics', { windowHours: intent.window ?? 24 });
      break;
    case 'activity':
      g.audit = await read(ctx, 'admin_search_audit', { limit: 25, ...(intent.denied ? { outcome: 'denied' } : {}) });
      break;
    default:
      break;
  }
  return g;
}

/**
 * One question from an administrator, answered from this deployment's own records.
 *
 * Nothing here calls a model. `route` reads the message for which records it is about; `gather`
 * reads them by invoking the same read capabilities the console's screens use, each through the
 * pipeline, so an administrator's role limits an answer exactly as it limits a screen and every
 * read is audited; `compose` writes the answer as an OpenUI Lang program over that data. The
 * browser's built-in model, where there is one, may choose the view for a message the router could
 * not read (`choice`) and may reword the summary from `facts` — it is never given a way to state
 * one.
 *
 * Changes are proposals inside the program: the page shows them, a person confirms, and the
 * capability that makes the change applies its own authorization and confirmation rules.
 */
export const adminAssistantAnswer = defineCapability<z.infer<typeof input>, AssistantAnswer>({
  name: 'admin_assistant_answer',
  title: 'Ask the console',
  description: 'Answers an administrator’s question about this site — visits, sessions, errors, replies, guests, the lifecycle, jobs, metrics, the audit trail — as a small dashboard composed from the site’s own records, with follow-up questions and, where a change was asked for, a proposal to review. Reads only; it changes nothing. Admins only.',
  kind: 'read',
  auth: 'admin',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 80_000,
  async handler(ctx, i) {
    const intent = route(i.message, i.choice ?? {});
    const trace: Trace = [];
    traces.set(ctx, trace);
    const gathered = await gather(ctx, intent);
    const answer = compose(intent, gathered, ADMIN_SCREENS);
    const windowed = intent.view === 'traffic' || intent.view === 'sessions' || intent.view === 'errors' || intent.view === 'metrics';
    return ok({ data: { ...answer, understood: intent.confidence > 0, window: windowed ? (intent.window ?? (intent.view === 'metrics' ? 24 : 168)) : null, read: trace }, sources: [] });
  },
});

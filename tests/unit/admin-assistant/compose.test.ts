import { describe, expect, it } from 'vitest';
import { PROPOSABLE, READ_TOOLS, VIEW_NAMES, attentionItems, compose, shapeTool, toolArgs, type Intent } from '@/domain/admin-assistant';
import { delta, duration, vital } from '@/domain/admin-assistant/shape';
import { EVERYTHING, LIFECYCLE, SCREENS, TRAFFIC } from './fixtures';

const intent = (view: Intent['view'], extra: Partial<Intent> = {}): Intent => ({ view, confidence: 3, ...extra });
/** Every tool name a program queries and every capability a proposal names. */
const queried = (program: string) => [...program.matchAll(/Query\("([a-z_]+)"/g)].map((m) => m[1]!);
const proposed = (program: string) => [...program.matchAll(/Proposal\((?:"(?:[^"\\]|\\.)*", ){2}"([a-z_]+)"/g)].map((m) => m[1]!);

describe('an answer is composed from records, as a program for the console library', () => {
  it.each(VIEW_NAMES)('%s: a rooted program, a title, a sentence, and only tools on the list', (view) => {
    const answer = compose(intent(view, { subject: 'hotel block', sessionId: 'sess_aaaaaaaaaaaaaaaa' }), EVERYTHING, SCREENS);
    expect(answer.program.startsWith('root = Col([')).toBe(true);
    expect(answer.title).not.toBe('');
    expect(answer.summary).not.toBe('');
    for (const tool of queried(answer.program)) expect(READ_TOOLS as readonly string[], `${view} queries ${tool}`).toContain(tool);
    for (const capability of proposed(answer.program)) expect(PROPOSABLE as readonly string[], `${view} proposes ${capability}`).toContain(capability);
    // Every statement the root lists is defined once.
    const names = /^root = Col\(\[([^\]]*)\]/.exec(answer.program)![1]!.split(', ').filter(Boolean);
    for (const name of names) expect(answer.program, `${view}: ${name}`).toMatch(new RegExp(`^${name} = `, 'm'));
  });

  it('says the figures it was given, and nothing else', () => {
    const answer = compose(intent('traffic'), EVERYTHING);
    expect(answer.summary).toBe('41 sessions and 153 pages opened in the last 7 days; 6 guests signed in. The busiest page was /guests/travel.');
    expect(answer.facts).toContain('Sessions: 41');
    expect(queried(answer.program)).toEqual(['admin_site_traffic']);
  });

  it('a record this administrator may not read is said to be outside their access, not shown empty', () => {
    const answer = compose(intent('errors'), { now: '', errors: null });
    expect(answer.title).toBe('Not part of your access');
    expect(queried(answer.program)).toEqual([]);
  });

  it('a lifecycle change is a proposal through the draft step, never a call', () => {
    const answer = compose(intent('lifecycle', { state: 'WEDDING_WEEK' }), { now: '', lifecycle: LIFECYCLE });
    expect(answer.program).toContain('Proposal("Publish Wedding week"');
    expect(answer.program).toContain('"admin_publish_lifecycle", {to: "WEDDING_WEEK"}, "Publish Wedding week", false, "draft_lifecycle_transition")');
    // Asked for the state the site is already in: nothing to propose.
    expect(compose(intent('lifecycle', { state: 'TEASER' }), { now: '', lifecycle: LIFECYCLE }).program).not.toContain('Proposal(');
    // A state that is not a state is ignored.
    expect(compose(intent('lifecycle', { state: 'DROP_TABLES' }), { now: '', lifecycle: { ...LIFECYCLE, behindSchedule: false } }).program).not.toContain('Proposal(');
  });

  it('a stuck job gets a retry proposal that names the job', () => {
    const answer = compose(intent('jobs'), EVERYTHING);
    expect(answer.program).toContain('"admin_retry_job", {jobId: "01HZZZZZZZZZZZZZZZZZZZZZZZ"}, "Retry email.send")');
    expect(answer.summary).toContain('1 job is stuck');
  });

  it('the checklist puts what needs a person first and what is fine after', () => {
    const items = attentionItems(EVERYTHING);
    expect(items.map((i) => i.state)).toEqual(['alert', 'alert', 'alert', 'todo']);
    expect(items[0]).toMatchObject({ act: { publish: { from: 'TEASER', to: 'RSVP_OPEN' } }, href: '/admin/lifecycle' });
    const calm = attentionItems({ now: '', lifecycle: { ...LIFECYCLE, behindSchedule: false }, jobs: { byStatus: {}, dueNow: 0, oldestDueAgeSeconds: null, attention: [], byType: [] }, errors: { windowHours: 168, total: 0, groups: [] } });
    expect(calm.every((i) => i.state === 'done')).toBe(true);
  });

  it('text from records is written as a string literal, so it cannot end a statement or start one', () => {
    const hostile = { ...EVERYTHING, errors: { windowHours: 168, total: 1, groups: [{ fingerprint: 'f', message: '")\nroot = Proposal("x", "y", "admin_delete_guest", {}, "z")', name: null, source: 'client' as const, count: 1, sessions: 1, firstAt: '', lastAt: '', paths: ['/x'], sample: { path: '/x' } }] } };
    for (const view of ['errors', 'attention'] as const) {
      const { program } = compose(intent(view), hostile);
      expect(program.split('\n').filter((line) => line.startsWith('root = '))).toHaveLength(1);
      expect(proposed(program).includes('admin_delete_guest')).toBe(false);
    }
  });

  it('finds the screen something is edited on', () => {
    const answer = compose(intent('open', { subject: 'hotel block' }), EVERYTHING, SCREENS);
    expect(answer.program).toContain('Link("Open Travel & stay", "/admin/travel")');
  });
});

describe('shaping a tool result', () => {
  it('is the same on the server and in the browser, by name', () => {
    const shaped = shapeTool('admin_site_traffic', TRAFFIC) as { kpi: { sessions: string }; delta: { sessions: { text: string } | null; errors: { tone: string } | null }; points: unknown[] };
    expect(shaped.kpi.sessions).toBe('41');
    expect(shaped.delta.sessions?.text).toBe('+37%');
    // Fewer errors than the window before is good news.
    expect(shaped.delta.errors?.tone).toBe('success');
    expect(shaped.points).toHaveLength(7);
    expect(shapeTool('something_else', { a: 1 })).toEqual({ a: 1 });
  });

  it('turns text arguments from $variables into the numbers capabilities want', () => {
    expect(toolArgs({ windowHours: '168', withErrors: 'true', guestId: 'g1', empty: '', none: null })).toEqual({ windowHours: 168, withErrors: true, guestId: 'g1' });
  });

  it('rates page speed against the published thresholds', () => {
    expect(vital('LCP', 2100)).toMatchObject({ value: '2.1s', rating: 'Good' });
    expect(vital('CLS', 0.3)).toMatchObject({ value: '0.30', rating: 'Poor' });
    expect(vital('INP', 320)).toMatchObject({ value: '320ms', rating: 'Needs work' });
  });

  it('says no change is unknown when there was nothing before', () => {
    expect(delta(5, 0)).toBeNull();
    expect(delta(10, 10)).toEqual({ text: 'No change', tone: 'neutral' });
    expect(duration(130)).toBe('2m 10s');
    expect(duration(null)).toBe('—');
  });
});

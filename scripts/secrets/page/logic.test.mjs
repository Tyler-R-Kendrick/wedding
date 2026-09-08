/**
 * Every decision the Secret Drop page makes, exercised to the last branch.
 *
 * These run on `node --test` rather than vitest, because that is what can measure them: vitest
 * transforms the module before V8 sees it, so V8 coverage attributes nothing to `logic.mjs`.
 * `npm run secrets:coverage` runs this file with Node's own coverage and fails under 100% — which
 * is the point, since this is the code that decides what a person is shown and asked to do.
 *
 * Why it exists at all: these decisions used to live inside an HTML string where no test could
 * reach them, and one was wrong. A status row computed for the *previously* chosen provider kept
 * deciding the ceremony after the choice changed, so selecting Postmark (sign in) still offered
 * Resend's "Get the link", and neither provider could be configured.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ago, createLogic } from './logic.mjs';
import { clientRegistry, METHOD_CEREMONY, SLOTS } from '../registry.mjs';

const REG = clientRegistry();
const L = createLogic(REG);

/** A slot shaped like the registry's, small enough to reason about. */
const slot = {
  id: 'email',
  name: 'Guest email',
  need: 'launch',
  does: 'Sends codes',
  options: [
    { id: 'resend', name: 'Resend', recommended: true, isOptOut: false, ceremony: 'link', host: 'resend.com', secrets: ['RESEND_API_KEY'], inferred: ['EMAIL_FROM'], note: '', warn: null },
    { id: 'postmark', name: 'Postmark', recommended: false, isOptOut: false, ceremony: 'signin', host: 'postmarkapp.com', secrets: ['RESEND_API_KEY'], inferred: [], note: '', warn: null },
    { id: 'byo', name: 'Your own SMTP', recommended: false, isOptOut: false, ceremony: 'paste', host: null, secrets: ['SMTP_URL'], inferred: [], note: '', warn: null },
  ],
};
const applySlot = {
  id: 'travel', name: 'Flights', need: 'feature', does: '', options: [
    { id: 'sky', name: 'Skyscanner', recommended: true, isOptOut: false, ceremony: 'apply', host: 'partners.skyscanner.net', secrets: ['SKY'], inferred: [], note: '', warn: null },
    { id: 'nohost', name: 'No host', recommended: false, isOptOut: false, ceremony: 'apply', host: null, secrets: ['X'], inferred: [], note: '', warn: null },
    { id: 'out', name: 'Just link out', recommended: false, isOptOut: true, ceremony: 'agent', host: null, secrets: [], inferred: [], note: '', warn: null },
  ],
};
const toolingSlot = {
  id: 'imagery', name: 'Design imagery', need: 'tooling', does: '', options: [
    { id: 'fal', name: 'fal.ai', recommended: true, isOptOut: false, ceremony: 'signin', host: 'fal.ai', secrets: ['FAL_KEY'], inferred: [], note: '', warn: null },
  ],
};

describe('which provider is in force', () => {
  it('uses the chosen one', () => {
    assert.equal(L.optionFor(slot, { email: 'postmark' }).id, 'postmark');
  });
  it('falls back to the recommended one when nothing is chosen', () => {
    assert.equal(L.optionFor(slot, {}).id, 'resend');
  });
  it('falls back to the first when none is recommended', () => {
    const none = { ...slot, options: slot.options.map((o) => ({ ...o, recommended: false })) };
    assert.equal(L.optionFor(none, {}).id, 'resend');
  });
  it('ignores a choice naming an option that no longer exists', () => {
    assert.equal(L.optionFor(slot, { email: 'gone' }).id, 'resend');
  });
  it('defaults its choices', () => {
    assert.equal(L.optionFor(slot).id, 'resend');
  });
});

describe('a status only speaks for the provider it was computed for', () => {
  const status = { email: { option: 'resend', state: 'queued', nextAction: { method: 'oauth' } } };

  it('applies when the chosen provider matches', () => {
    assert.equal(L.statusFor(slot, status, { email: 'resend' }).option, 'resend');
  });

  it('does not apply after the provider is changed — the bug', () => {
    // The whole defect in one place: Postmark is a sign-in, and Resend's OAuth status must not
    // decide for it.
    assert.equal(L.statusFor(slot, status, { email: 'postmark' }), null);
    assert.equal(L.ceremonyIdFor(slot, status, { email: 'postmark' }), 'signin');
    assert.equal(L.ceremonyIdFor(slot, status, { email: 'resend' }), 'link');
    assert.equal(L.actionFor(slot, { status, choices: { email: 'postmark' } }).kind, 'signin');
    assert.equal(L.actionFor(slot, { status, choices: { email: 'resend' } }).kind, 'link');
  });

  it('applies a status that names no option at all', () => {
    const legacy = { email: { state: 'acquired', method: 'oauth', set: 1, of: 1 } };
    assert.equal(L.statusFor(slot, legacy, {}).state, 'acquired');
  });

  it('is null when there is no row', () => {
    assert.equal(L.statusFor(slot, {}, {}), null);
    assert.equal(L.statusFor(slot), null);
  });
});

describe('where a slot has got to', () => {
  const at = (state) => ({ email: { option: 'resend', state } });
  it('is skipped for an opt-out option regardless of status', () => {
    assert.equal(L.stateOf(applySlot, { travel: { option: 'out', state: 'acquired' } }, { travel: 'out' }), 'skipped');
  });
  it('is queued with no status', () => {
    assert.equal(L.stateOf(slot, {}, {}), 'queued');
    assert.equal(L.stateOf(slot), 'queued');
  });
  it('is queued when the status belongs to another provider', () => {
    assert.equal(L.stateOf(slot, { email: { option: 'resend', state: 'acquired' } }, { email: 'postmark' }), 'queued');
  });
  it('maps every state the ladder writes', () => {
    assert.equal(L.stateOf(slot, at('live'), {}), 'working');
    assert.equal(L.stateOf(slot, at('acquired'), {}), 'connected');
    assert.equal(L.stateOf(slot, at('already-set'), {}), 'connected');
    assert.equal(L.stateOf(slot, at('rejected'), {}), 'fault');
    assert.equal(L.stateOf(slot, at('failed'), {}), 'fault');
    assert.equal(L.stateOf(slot, at('skipped'), {}), 'skipped');
    assert.equal(L.stateOf(slot, at('something-new'), {}), 'queued');
  });
});

describe('which ceremony a slot is asking for', () => {
  it('prefers the rung the ladder actually stopped on', () => {
    const status = { email: { option: 'resend', state: 'queued', nextAction: { method: 'browser' } } };
    // Resend is nominally a link, but the ladder fell through to the browser rung: sign in.
    assert.equal(L.ceremonyIdFor(slot, status, {}), 'signin');
  });
  it('ignores a rung it does not recognise', () => {
    const status = { email: { option: 'resend', state: 'queued', nextAction: { method: 'teleport' } } };
    assert.equal(L.ceremonyIdFor(slot, status, {}), 'link');
  });
  it('uses the provider when there is no live rung', () => {
    assert.equal(L.ceremonyIdFor(slot, { email: { option: 'resend', state: 'queued' } }, {}), 'link');
    assert.equal(L.ceremonyIdFor(slot), 'link');
  });
  it('resolves to a ceremony record, falling back to paste for an unknown id', () => {
    assert.equal(L.ceremonyOf(slot, {}, {}).label, REG.ceremony.link.label);
    const odd = { ...slot, options: [{ ...slot.options[0], ceremony: 'nonsense' }] };
    assert.equal(L.ceremonyOf(odd, {}, {}), REG.ceremony.paste);
    assert.equal(L.ceremonyOf(slot).label, REG.ceremony.link.label);
  });
});

describe("whether a slot is the person's problem", () => {
  it('is not, once it is connected, working or skipped', () => {
    for (const state of ['acquired', 'live', 'skipped']) {
      assert.equal(L.needsYou(slot, { email: { option: 'resend', state } }, {}), false);
    }
  });
  it('is, when the ladder failed', () => {
    assert.equal(L.needsYou(slot, { email: { option: 'resend', state: 'failed' } }, {}), true);
  });
  it('is not, for tooling nobody has asked for', () => {
    assert.equal(L.needsYou(toolingSlot, {}, {}), false);
  });
  it('is, for tooling once it has been chosen', () => {
    assert.equal(L.needsYou(toolingSlot, {}, { imagery: 'fal' }), true);
  });
  it('is not, while the next rung is one Claude runs itself', () => {
    // `mcp` and `authmd` are agent ceremonies: there is nothing for a person to do yet.
    const status = { email: { option: 'resend', state: 'queued', nextAction: { method: 'mcp' } } };
    assert.equal(L.needsYou(slot, status, {}), false);
  });
  it('is, when the next rung needs a human', () => {
    assert.equal(L.needsYou(slot, {}, {}), true);
    assert.equal(L.needsYou(slot), true);
  });
});

describe('ceremonies already answered', () => {
  const ceremonies = [
    { id: 'c1', credential: 'email', status: 'waiting' },
    { id: 'c2', credential: 'other', status: 'waiting' },
  ];
  it('finds the open one for this slot only', () => {
    assert.equal(L.ceremonyState(slot, ceremonies).open.id, 'c1');
    assert.equal(L.ceremonyState(slot, ceremonies).settling, null);
  });
  it('treats a ceremony with no status as open', () => {
    assert.equal(L.ceremonyState(slot, [{ id: 'c3', credential: 'email' }]).open.id, 'c3');
  });
  it('treats a code already received as settling, never as open', () => {
    for (const status of ['code-received', 'exchanging']) {
      const state = L.ceremonyState(slot, [{ id: 'c4', credential: 'email', status }]);
      assert.equal(state.settling.id, 'c4');
      assert.equal(state.open, null);
    }
  });
  it('treats a failed exchange as settling, so the reason survives', () => {
    // Without this the strip falls back to "Get the link" and the person is never told that the
    // code they approved could not be exchanged.
    const state = L.ceremonyState(slot, [{ id: 'c5', credential: 'email', status: 'failed' }]);
    assert.equal(state.settling.id, 'c5');
    assert.equal(state.open, null);
  });
  it('finds nothing when there are no ceremonies', () => {
    assert.equal(L.ceremonyState(slot, []).open, null);
    assert.equal(L.ceremonyState(slot).open, null);
  });
  it('accepts a bare slot id, for callers that only have one', () => {
    assert.equal(L.ceremonyState('email', ceremonies).open.id, 'c1');
  });
});

/**
 * The bug this file was extended for. A ceremony belongs to a provider, not just a slot: the
 * artifact held a Resend OAuth link for `email`, and because `actionFor` looked for a ceremony
 * before it looked at the choice, selecting Postmark produced "Approve" pointing at Resend.
 * Choosing a provider appeared to do nothing.
 */
describe('a ceremony belongs to the provider that started it', () => {
  const resendCeremony = [{ id: 'email', credential: 'email', status: 'waiting', openedAt: '2026-09-07T23:42:14Z' }];
  const legacyStatus = { email: { option: 'resend', state: 'waiting-on-you', nextAction: { method: 'oauth' } } };

  it('says which provider a record is for, preferring what it records over inference', () => {
    assert.equal(L.ownerOf({ option: 'postmark' }, slot, legacyStatus), 'postmark');
    // Older ceremonies carry no option, but the status row from the same run names the provider.
    assert.equal(L.ownerOf({}, slot, legacyStatus), 'resend');
    assert.equal(L.ownerOf({}, slot, {}), null);
    assert.equal(L.ownerOf(null, slot), null);
  });

  it('holds nothing against a record whose provider cannot be determined', () => {
    assert.equal(L.stillChosen({}, slot, {}, { email: 'postmark' }), true);
  });

  it('drops a ceremony left over from a provider no longer chosen', () => {
    assert.equal(L.ceremonyState(slot, resendCeremony, legacyStatus, { email: 'postmark' }).open, null);
    assert.equal(L.ceremonyState(slot, resendCeremony, legacyStatus, { email: 'byo' }).open, null);
    // …and keeps it for the provider it actually belongs to.
    assert.equal(L.ceremonyState(slot, resendCeremony, legacyStatus, { email: 'resend' }).open.id, 'email');
  });

  it('offers the chosen provider its own ceremony, not the previous one', () => {
    assert.equal(L.actionFor(slot, { status: legacyStatus, choices: { email: 'postmark' }, ceremonies: resendCeremony }).kind, 'signin');
    assert.equal(L.actionFor(slot, { status: legacyStatus, choices: { email: 'byo' }, ceremonies: resendCeremony }).kind, 'none');
    assert.equal(L.actionFor(slot, { status: legacyStatus, choices: { email: 'resend' }, ceremonies: resendCeremony }).kind, 'approve');
  });

  it('uses the option a newer ceremony records, ignoring the status', () => {
    const stamped = [{ id: 'email', credential: 'email', status: 'waiting', option: 'postmark' }];
    assert.equal(L.actionFor(slot, { status: legacyStatus, choices: { email: 'postmark' }, ceremonies: stamped }).kind, 'approve');
    assert.equal(L.actionFor(slot, { status: legacyStatus, choices: { email: 'resend' }, ceremonies: stamped }).kind, 'link');
  });
});

describe('an authorization link has a deadline', () => {
  const link = (expiresAt) => [{ id: 'email', credential: 'email', status: 'waiting', option: 'resend', expiresAt }];
  const now = Date.parse('2026-09-08T02:00:00Z');
  it('knows when one has run out', () => {
    assert.equal(L.expired({ expiresAt: '2026-09-07T20:57:00Z' }, now), true);
    assert.equal(L.expired({ expiresAt: '2026-09-08T03:00:00Z' }, now), false);
    // No deadline recorded, or an unreadable one, is not a reason to discard it.
    assert.equal(L.expired({}, now), false);
    assert.equal(L.expired({ expiresAt: 'soon' }, now), false);
    assert.equal(L.expired(null, now), false);
    assert.equal(L.expired({ expiresAt: '2020-01-01T00:00:00Z' }), true);
  });
  it('stops offering an approval the provider will refuse', () => {
    const choices = { email: 'resend' };
    assert.equal(L.ceremonyState(slot, link('2026-09-07T20:57:00Z'), {}, choices, now).open, null);
    assert.equal(L.ceremonyState(slot, link('2026-09-08T03:00:00Z'), {}, choices, now).open.id, 'email');
  });
  it('falls back to asking for a fresh link once the old one is dead', () => {
    // Not "Approve" into a dead end: the provider's own ceremony, from the top.
    const dead = link('2026-09-07T20:57:00Z');
    assert.equal(L.ceremonyState(slot, dead, {}, { email: 'resend' }, now).open, null);
  });
});

describe('a failure outlives the link that caused it', () => {
  const dead = { id: 'c', credential: 'email', status: 'failed', expiresAt: '2020-01-01T00:00:00Z', detail: 'the code was already used' };
  it('keeps a failed ceremony past its deadline, with its reason', () => {
    assert.equal(L.expired(dead), false);
    const action = L.actionFor(slot, { ceremonies: [dead] });
    assert.equal(action.kind, 'settling');
    assert.equal(action.work.detail, 'the code was already used');
  });
  it('still hides a lapsed link that has not failed', () => {
    assert.equal(L.expired({ ...dead, status: 'waiting' }), true);
  });
});

describe('hand-offs already asked for', () => {
  it('is active while it is outstanding', () => {
    assert.ok(L.askedFor(slot, { email: { status: 'requested' } }));
    assert.ok(L.askedFor('email', { email: { status: 'requested' } }));
  });
  it('is not active once finished or cancelled', () => {
    assert.equal(L.askedFor(slot, { email: { status: 'done' } }), null);
    assert.equal(L.askedFor(slot, { email: { status: 'cancelled' } }), null);
  });
  it('is not active when there is none', () => {
    assert.equal(L.askedFor(slot, {}), null);
    assert.equal(L.askedFor(slot), null);
  });
  it('is not active once you have chosen a different provider', () => {
    // Asking Claude to sign in to Postmark says nothing about SES; showing "Claude is on it"
    // for a provider you have since moved away from is the same lie in a quieter form.
    const asked = { email: { status: 'requested', option: 'postmark', kind: 'signin' } };
    assert.ok(L.askedFor(slot, asked, {}, { email: 'postmark' }));
    assert.equal(L.askedFor(slot, asked, {}, { email: 'byo' }), null);
    assert.equal(L.actionFor(slot, { handoffs: asked, choices: { email: 'byo' } }).kind, 'none');
  });
});

describe('what is happening to a hand-off', () => {
  it('has nothing to say about a hand-off that is not there', () => {
    assert.equal(L.workOf(null), null);
    assert.equal(L.workOf(undefined), null);
  });

  it('calls a request nobody has started queued, not "Claude is on it"', () => {
    const w = L.workOf({ status: 'requested', requestedAt: 'q', detail: 'ignored while queued' });
    assert.equal(w.state, 'queued');
    assert.equal(w.since, 'q');
    assert.equal(w.detail, null);
    // Asking again is the only thing left to do when nothing picked it up.
    assert.equal(w.canRetry, true);
  });

  it('times running work from when the work started, not from when it was asked for', () => {
    assert.equal(L.workOf({ status: 'running', startedAt: 's', requestedAt: 'q' }).since, 's');
    assert.equal(L.workOf({ status: 'running', requestedAt: 'q' }).since, 'q');
    assert.equal(L.workOf({ status: 'running' }).canRetry, false);
  });

  it('reports a failure with what it said, and a success as done', () => {
    const bad = L.workOf({ status: 'failed', requestedAt: 'q', detail: 'unknown provider postmarkapp.com' });
    assert.equal(bad.state, 'failed');
    assert.equal(bad.detail, 'unknown provider postmarkapp.com');
    assert.equal(bad.canRetry, true);
    assert.equal(L.workOf({ status: 'failed' }).detail, null);
    const good = L.workOf({ status: 'done' });
    assert.equal(good.state, 'done');
    assert.equal(good.canRetry, false);
  });

  it('carries what the strip needs to name the work, with defaults it can render', () => {
    const w = L.workOf({ status: 'running', kind: 'link', host: 'resend.com', progressAt: 'p', log: 'line' });
    assert.equal(w.kind, 'link');
    assert.equal(w.host, 'resend.com');
    assert.equal(w.progressAt, 'p');
    assert.equal(w.log, 'line');
    const bare = L.workOf({ status: 'requested' });
    assert.equal(bare.kind, 'signin');
    assert.equal(bare.host, null);
    assert.equal(bare.progressAt, null);
    assert.equal(bare.log, '');
  });

  it('is the work the strip carries, so a press has a state and not a slogan', () => {
    const action = L.actionFor(slot, { handoffs: { email: { status: 'running', startedAt: 's' } } });
    assert.equal(action.kind, 'asked');
    assert.equal(action.work.state, 'running');
  });
});

describe('what is happening to an approved link', () => {
  it('has nothing to say about a ceremony that is not there', () => {
    assert.equal(L.settleOf(null), null);
    assert.equal(L.settleOf(undefined), null);
  });

  it('calls a received code queued, because nothing has exchanged it yet', () => {
    // The page said "finishing up" here for ever. Nothing was finishing it up.
    const w = L.settleOf({ status: 'code-received', receivedAt: 'r', detail: 'ignored while queued' });
    assert.equal(w.state, 'queued');
    assert.equal(w.since, 'r');
    assert.equal(w.detail, null);
    assert.equal(w.canRetry, false);
  });

  it('reads both words the two writers use for a running exchange', () => {
    // `acquire.mjs` says `exchanging`; `serve.mjs` says `running`. Reading one and not the other
    // shows live work as "nothing has finished this yet".
    for (const status of ['exchanging', 'running']) {
      assert.equal(L.settleOf({ status, exchangeStartedAt: 'x' }).state, 'running');
      const state = L.ceremonyState(slot, [{ id: 'c6', credential: 'email', status }]);
      assert.equal(state.settling.id, 'c6', `"${status}" is not treated as settling`);
    }
  });

  it('times a running exchange from when the exchange started', () => {
    const w = L.settleOf({ status: 'exchanging', exchangeStartedAt: 'x', receivedAt: 'r', openedAt: 'o' });
    assert.equal(w.state, 'running');
    assert.equal(w.since, 'x');
    assert.equal(L.settleOf({ status: 'exchanging', receivedAt: 'r', openedAt: 'o' }).since, 'r');
    assert.equal(L.settleOf({ status: 'exchanging', openedAt: 'o' }).since, 'o');
  });

  it('reports a failure with its reason, and offers a way back', () => {
    const w = L.settleOf({ status: 'failed', finishedAt: 'f', detail: 'the code was already used' });
    assert.equal(w.state, 'failed');
    assert.equal(w.since, 'f');
    assert.equal(w.detail, 'the code was already used');
    assert.equal(w.canRetry, true);
    // A failure with no reason still reports as a failure rather than as nothing.
    assert.equal(L.settleOf({ status: 'failed' }).detail, null);
  });

  it('falls back through the times it might have, and to none at all', () => {
    assert.equal(L.settleOf({ status: 'code-received', openedAt: 'o' }).since, 'o');
    assert.equal(L.settleOf({ status: 'code-received', startedAt: 's' }).since, 's');
    assert.equal(L.settleOf({ status: 'code-received' }).since, undefined);
  });

  it('is the work the strip carries, so the page renders states and not a slogan', () => {
    const ceremonies = [{ id: 'c', credential: 'email', status: 'exchanging', exchangeStartedAt: 'x' }];
    const action = L.actionFor(slot, { ceremonies });
    assert.equal(action.kind, 'settling');
    assert.equal(action.work.state, 'running');
  });
});

describe('the one control a strip offers', () => {
  it('offers nothing to press once the code is in', () => {
    const ceremonies = [{ id: 'c', credential: 'email', status: 'code-received' }];
    assert.equal(L.actionFor(slot, { ceremonies }).kind, 'settling');
  });
  it('offers approval while a ceremony is open, and says when it was reopened', () => {
    const fresh = L.actionFor(slot, { ceremonies: [{ id: 'c', credential: 'email', status: 'waiting' }] });
    assert.equal(fresh.kind, 'approve');
    assert.equal(fresh.reopened, false);
    const again = L.actionFor(slot, { ceremonies: [{ id: 'c', credential: 'email', status: 'waiting', openedAt: '2026-01-01T00:00:00Z' }] });
    assert.equal(again.kind, 'approve');
    assert.equal(again.reopened, true);
  });
  it('reports the ask rather than the button that made it', () => {
    assert.equal(L.actionFor(slot, { handoffs: { email: { status: 'requested', kind: 'signin' } } }).kind, 'asked');
  });
  it('ignores a ceremony for another slot entirely', () => {
    assert.equal(L.actionFor(slot, { ceremonies: [{ id: 'x', credential: 'storage', status: 'waiting' }] }).kind, 'link');
  });
  it('prefers a live ceremony over an outstanding ask', () => {
    const both = { ceremonies: [{ id: 'c', credential: 'email', status: 'waiting' }], handoffs: { email: { status: 'requested' } } };
    assert.equal(L.actionFor(slot, both).kind, 'approve');
  });
  it('offers each provider its own ceremony', () => {
    assert.equal(L.actionFor(slot, { choices: { email: 'postmark' } }).kind, 'signin');
    assert.equal(L.actionFor(slot, { choices: { email: 'resend' } }).kind, 'link');
    assert.equal(L.actionFor(slot, { choices: { email: 'byo' } }).kind, 'none');
    assert.equal(L.actionFor(applySlot, { choices: { travel: 'sky' } }).kind, 'apply');
  });
  it('does not offer an application with nowhere to apply', () => {
    assert.equal(L.actionFor(applySlot, { choices: { travel: 'nohost' } }).kind, 'none');
  });
  it('offers nothing for an option that asks nothing', () => {
    assert.equal(L.actionFor(applySlot, { choices: { travel: 'out' } }).kind, 'none');
  });
  it('defaults its inputs', () => {
    assert.equal(L.actionFor(slot).kind, 'link');
  });
});

describe('where the paste fields go', () => {
  it('shows them inline only for a paste ceremony', () => {
    assert.deepEqual(L.pasteFields(slot, {}, { email: 'byo' }), ['SMTP_URL']);
    assert.deepEqual(L.pasteFields(slot, {}, { email: 'resend' }), []);
    assert.deepEqual(L.pasteFields(slot), []);
  });
  it('offers the quiet escape everywhere else, when there is a secret to type', () => {
    assert.equal(L.allowsManualEntry(slot, {}, { email: 'resend' }), true);
    assert.equal(L.allowsManualEntry(slot, {}, { email: 'byo' }), false);
    assert.equal(L.allowsManualEntry(applySlot, {}, { travel: 'out' }), false);
    assert.equal(L.allowsManualEntry(slot), true);
  });
});

describe('what a connected row says it holds', () => {
  const bound = (row) => L.boundSummary(slot, { email: { option: 'resend', state: 'acquired', ...row } }, {});
  it('names the count and the rung', () => {
    assert.equal(bound({ method: 'oauth', set: 1, of: 1 }), '1/1 held · you approved a link');
  });
  it('names every rung the ladder can finish on', () => {
    const expected = {
      authmd: 'registered', register: 'registered', oauth: 'you approved a link',
      device: 'you approved a link', browser: 'you signed in', harness: 'borrowed a session',
      manual: 'you provided it', generate: 'generated', derive: 'derived',
      detect: 'already set', mcp: 'via MCP',
    };
    for (const [method, phrase] of Object.entries(expected)) {
      assert.equal(bound({ method, of: 2, set: 2 }), `2/2 held · ${phrase}`);
    }
  });
  it('falls back to the count alone for a rung it cannot name', () => {
    assert.equal(bound({ method: 'teleport', of: 1, set: 1 }), '1/1 held');
  });
  it('names the rung alone when no count was recorded', () => {
    assert.equal(bound({ method: 'derive', of: 0 }), 'derived');
  });
  it('uses the total when the count is missing', () => {
    assert.equal(bound({ method: 'derive', of: 3 }), '3/3 held · derived');
  });
  it('says nothing when there is nothing to say', () => {
    assert.equal(bound({ of: 0 }), null);
    assert.equal(L.boundSummary(slot, {}, {}), null);
    assert.equal(L.boundSummary(slot), null);
    assert.equal(L.boundSummary(slot, { email: { option: 'resend', state: 'queued' } }, {}), null);
  });
});

describe('how long ago', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  it('reads a blank or unparseable time as nothing', () => {
    assert.equal(ago(undefined, now), '');
    assert.equal(ago('not a date', now), '');
  });
  it('counts up through the units', () => {
    assert.equal(ago('2026-09-07T11:59:30Z', now), 'just now');
    assert.equal(ago('2026-09-07T11:56:00Z', now), '4 min ago');
    assert.equal(ago('2026-09-07T10:00:00Z', now), '2 h ago');
    assert.equal(ago('2026-09-05T12:00:00Z', now), '2 d ago');
  });
  it('uses the real clock by default', () => {
    assert.equal(ago(new Date().toISOString()), 'just now');
  });
});

describe('the registry the page is built from', () => {
  it('declares a ceremony its ladder can actually reach', () => {
    // `apply` is the exception by definition: a human at the provider reviews it, so no rung can
    // automate it. Everything else must be a ceremony some rung of that option's ladder produces,
    // or the page promises a route the tooling will never take.
    for (const s of SLOTS) {
      for (const o of s.options) {
        if (o.ceremony === 'apply') continue;
        const reachable = new Set(o.ladder.map((r) => METHOD_CEREMONY[r.method]));
        assert.ok(reachable.has(o.ceremony), `${s.id}/${o.id} declares ${o.ceremony}, ladder reaches {${[...reachable]}}`);
      }
    }
  });

  it('gives every option in every slot the control its own ceremony implies', () => {
    // Selecting any provider must produce a coherent answer — never the previous provider's.
    for (const s of REG.slots) {
      for (const o of s.options) {
        const choices = { [s.id]: o.id };
        const cer = L.ceremonyIdFor(s, {}, choices);
        const expected = { signin: 'signin', link: 'link', apply: o.host ? 'apply' : 'none', agent: 'none', paste: 'none' }[cer];
        assert.equal(L.actionFor(s, { choices }).kind, expected, `${s.id}/${o.id} (${cer})`);
      }
    }
  });
});

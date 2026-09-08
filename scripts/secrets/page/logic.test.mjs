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
    assert.equal(L.ceremonyState('email', ceremonies).open.id, 'c1');
    assert.equal(L.ceremonyState('email', ceremonies).settling, null);
  });
  it('treats a ceremony with no status as open', () => {
    assert.equal(L.ceremonyState('email', [{ id: 'c3', credential: 'email' }]).open.id, 'c3');
  });
  it('treats a code already received as settling, never as open', () => {
    for (const status of ['code-received', 'exchanging']) {
      const state = L.ceremonyState('email', [{ id: 'c4', credential: 'email', status }]);
      assert.equal(state.settling.id, 'c4');
      assert.equal(state.open, null);
    }
  });
  it('finds nothing when there are no ceremonies', () => {
    assert.equal(L.ceremonyState('email', []).open, null);
    assert.equal(L.ceremonyState('email').open, null);
  });
});

describe('hand-offs already asked for', () => {
  it('is active while it is outstanding', () => {
    assert.ok(L.askedFor('email', { email: { status: 'requested' } }));
  });
  it('is not active once finished or cancelled', () => {
    assert.equal(L.askedFor('email', { email: { status: 'done' } }), null);
    assert.equal(L.askedFor('email', { email: { status: 'cancelled' } }), null);
  });
  it('is not active when there is none', () => {
    assert.equal(L.askedFor('email', {}), null);
    assert.equal(L.askedFor('email'), null);
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

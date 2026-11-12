/**
 * Scores one answer against what a good answer to that request must do (`vars.expect`).
 * Every rule is a plain yes/no about the answer; a case's score is the share of its rules that
 * hold, and it passes only when all of them do. Rules:
 *
 *   shape            the kind of answer (one name, or any of a list)
 *   clarifies        true: it asks before answering; false: it answers at once
 *   asksAbout        what the question covers (diet, meal)
 *   ours             our own places in it: min, max, includes, excludes, categories (every place is
 *                    one of these), kidFriendly (every place is), inHotel (every place is)
 *   slot             every one of our places is offered for this day and/or part of the day
 *   outside          places from outside our list: min, max, kinds (every one), diet (every one is
 *                    tagged for it), cuisine (at least one has it), notNamed (none matches)
 *   own              the guest's own plan: title, slots; ownNone: true when there must be none
 *   text             includes / excludes: patterns over every word the guest reads
 *   next             includes / excludes: the follow-ups offered
 */
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const re = (s) => new RegExp(s, 'i');

export default function score(output, context) {
  let a;
  try {
    a = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { pass: false, score: 0, reason: 'the planner did not return an answer' };
  }
  const e = context?.vars?.expect ?? {};
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  if (e.shape !== undefined) check('shape', arr(e.shape).includes(a.shape), `is ${a.shape}, wanted ${arr(e.shape).join(' or ')}`);
  if (e.clarifies !== undefined) check('clarifies', a.clarifies === e.clarifies, e.clarifies ? 'did not ask first' : 'asked a question it did not need');
  for (const about of arr(e.asksAbout)) check(`asks about ${about}`, a.asksAbout.includes(about), `asked about ${a.asksAbout.join(', ') || 'nothing'}`);

  const ours = a.ours ?? [];
  const o = e.ours ?? {};
  if (o.min !== undefined) check(`ours >= ${o.min}`, ours.length >= o.min, `${ours.length} of our places`);
  if (o.max !== undefined) check(`ours <= ${o.max}`, ours.length <= o.max, `${ours.length} of our places`);
  for (const id of arr(o.includes)) check(`ours has ${id}`, ours.some((p) => p.id === id), ours.map((p) => p.id).join(', '));
  for (const id of arr(o.excludes)) check(`ours lacks ${id}`, !ours.some((p) => p.id === id), `${id} is in the answer`);
  if (o.anyOf) check(`ours has one of ${arr(o.anyOf).join('/')}`, ours.some((p) => arr(o.anyOf).includes(p.id)), ours.map((p) => p.id).join(', '));
  if (o.categories) check(`ours all ${arr(o.categories).join('/')}`, ours.length > 0 && ours.every((p) => arr(o.categories).includes(p.category)), ours.map((p) => `${p.id}:${p.category}`).join(', '));
  if (o.kidFriendly) check('ours all kid-friendly', ours.length > 0 && ours.every((p) => p.kidFriendly), ours.filter((p) => !p.kidFriendly).map((p) => p.id).join(', '));
  if (o.inHotel) check('ours all in the hotel', ours.length > 0 && ours.every((p) => p.inHotel), ours.filter((p) => !p.inHotel).map((p) => p.id).join(', '));

  if (e.slot) {
    const off = ours.filter((p) => (e.slot.day && p.day !== e.slot.day) || (e.slot.part && p.part !== e.slot.part));
    check(`offered for ${[e.slot.day, e.slot.part].filter(Boolean).join(' ')}`, ours.length > 0 && off.length === 0, off.map((p) => `${p.id}:${p.day ?? '?'} ${p.part ?? '?'}`).join(', ') || 'no places');
  }

  const outside = a.outside ?? [];
  const x = e.outside ?? {};
  if (x.min !== undefined) check(`outside >= ${x.min}`, outside.length >= x.min, `${outside.length} from outside our list`);
  if (x.max !== undefined) check(`outside <= ${x.max}`, outside.length <= x.max, `${outside.length} from outside our list: ${outside.map((p) => p.name).join(', ')}`);
  if (x.kinds) check(`outside all ${arr(x.kinds).join('/')}`, outside.length > 0 && outside.every((p) => arr(x.kinds).includes(p.kind)), outside.map((p) => `${p.name}:${p.kind}`).join(', '));
  if (x.diet) check(`outside all tagged ${x.diet}`, outside.length > 0 && outside.every((p) => p.diet.includes(x.diet)), outside.filter((p) => !p.diet.includes(x.diet)).map((p) => p.name).join(', ') || 'none found');
  if (x.cuisine) check(`outside has ${x.cuisine}`, outside.some((p) => p.cuisine.some((c) => re(x.cuisine).test(c))), outside.map((p) => `${p.name}:${p.cuisine.join('/')}`).join(', '));
  if (x.allCuisine) check(`outside all ${x.allCuisine}`, outside.length > 0 && outside.every((p) => p.cuisine.some((c) => re(x.allCuisine).test(c))), outside.map((p) => `${p.name}:${p.cuisine.join('/')}`).join(', '));
  if (x.near !== undefined) check(`outside within ${x.near} m`, outside.length > 0 && outside.every((p) => p.meters <= x.near), outside.filter((p) => p.meters > x.near).map((p) => `${p.name}:${p.meters}`).join(', '));
  for (const pat of arr(x.notNamed)) check(`outside not named ${pat}`, !outside.some((p) => re(pat).test(p.name)), outside.filter((p) => re(pat).test(p.name)).map((p) => p.name).join(', '));
  if (x.distinct) check('outside names distinct', new Set(outside.map((p) => p.name.toLowerCase())).size === outside.length, outside.map((p) => p.name).join(', '));

  if (e.own) {
    check('own plan offered', !!a.own, 'no plan of their own was offered');
    if (a.own && e.own.title) check(`own title ${e.own.title}`, a.own.title === e.own.title, `"${a.own.title}"`);
    if (a.own && e.own.slots) check('own slots', JSON.stringify(a.own.slots) === JSON.stringify(e.own.slots), JSON.stringify(a.own.slots));
  }
  if (e.ownNone) check('no own plan', !a.own, a.own ? `offered "${a.own.title}"` : '');

  for (const pat of arr(e.text?.includes)) check(`says /${pat}/`, re(pat).test(a.text), 'not in the answer');
  for (const pat of arr(e.text?.excludes)) check(`never says /${pat}/`, !re(pat).test(a.text), `found: ${(a.text.match(re(pat)) ?? [''])[0]}`);
  for (const n of arr(e.next?.includes)) check(`offers "${n}" next`, a.next.includes(n), a.next.join(' / '));
  for (const n of arr(e.next?.excludes)) check(`does not offer "${n}" next`, !a.next.includes(n), a.next.join(' / '));

  if (!checks.length) return { pass: false, score: 0, reason: 'this case expects nothing' };
  const failed = checks.filter((c) => !c.ok);
  const value = (checks.length - failed.length) / checks.length;
  const category = String(context?.vars?.category ?? 'other');
  return {
    pass: failed.length === 0,
    score: value,
    reason: failed.length ? failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ') : `all ${checks.length} rules hold`,
    namedScores: { [category]: value },
  };
}

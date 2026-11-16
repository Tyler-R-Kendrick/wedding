import { describe, expect, it } from 'vitest';
import { householdSurnamesOf, matchGuestsByName, matchRank, namesMatch, parseProviderProfile, sameGivenName, SIGN_IN_MAX_RANK, type ProviderProfileName } from '@/domain/identity/name-match';

/**
 * A guest list shaped like the couple's planning sheet, with invented names: couples under one
 * surname and under two, a partner listed by first name only, lines with no surname at all, two
 * people with the same name in different households, a named plus-one, a maiden name on record,
 * and the wedding planner. Sign-in by name has to find the one person a profile is, for either
 * person on a line, and refuse whatever two people could be.
 */
type G = { id: string; householdId: string; firstName: string; lastName: string; alternateNames?: string[] };
const LIST: G[] = [
  // "Alma Jarvik and Jody O'Brennan": two surnames.
  { id: 'alma', householdId: 'h1', firstName: 'Alma', lastName: 'Jarvik' },
  { id: 'jody', householdId: 'h1', firstName: 'Jody', lastName: "O'Brennan" },
  // "Bram and Nora Fitzwilliam": one surname. Nora's maiden name is on record.
  { id: 'bram', householdId: 'h2', firstName: 'Bram', lastName: 'Fitzwilliam' },
  { id: 'nora', householdId: 'h2', firstName: 'Nora', lastName: 'Fitzwilliam', alternateNames: ['Nora Halloran'] },
  // "Neal Kendall and Tilly": Tilly has no surname on the list.
  { id: 'neal', householdId: 'h3', firstName: 'Neal', lastName: 'Kendall' },
  { id: 'tilly', householdId: 'h3', firstName: 'Tilly', lastName: '' },
  // "Mick and Christa": no surname at all.
  { id: 'mick', householdId: 'h4', firstName: 'Mick', lastName: '' },
  { id: 'christa', householdId: 'h4', firstName: 'Christa', lastName: '' },
  // Two people called Barton Barnaby, in two households.
  { id: 'barton1', householdId: 'h5', firstName: 'Barton', lastName: 'Barnaby' },
  { id: 'mara', householdId: 'h5', firstName: 'Mara', lastName: 'Barnaby' },
  { id: 'barton2', householdId: 'h6', firstName: 'Barton', lastName: 'Barnaby' },
  { id: 'corin', householdId: 'h6', firstName: 'Corin', lastName: 'Le Marchand' },
  // "Alex Fitzwilliam and Janet Marlow": a named plus-one; and a Jan Fitzwilliam on a line of her own.
  { id: 'alex', householdId: 'h7', firstName: 'Alex', lastName: 'Fitzwilliam' },
  { id: 'janet', householdId: 'h7', firstName: 'Janet', lastName: 'Marlow' },
  { id: 'jan', householdId: 'h8', firstName: 'Jan', lastName: 'Fitzwilliam' },
  // Three Saras.
  { id: 'sara-fox', householdId: 'h9', firstName: 'Sara', lastName: 'Fox' },
  { id: 'sara-feng', householdId: 'h10', firstName: 'Sara', lastName: 'Feng' },
  { id: 'justin', householdId: 'h10', firstName: 'Justin', lastName: 'Feng' },
  { id: 'sara-oswald', householdId: 'h11', firstName: 'Sara', lastName: 'Oswald' },
  // Listed by what the couple call her.
  { id: 'grandma', householdId: 'h12', firstName: 'Grandma', lastName: 'Winslow' },
  // "Michael and Colleen Rockwell", listed in full; and a typo on our side.
  { id: 'michael', householdId: 'h13', firstName: 'Michael', lastName: 'Rockwell' },
  { id: 'colleen', householdId: 'h13', firstName: 'Colleen', lastName: 'Rockwell' },
  { id: 'dinah', householdId: 'h14', firstName: 'Dinah', lastName: 'Bondrell' },
  // The wedding planner, not on the planning sheet: a guest record of her own, with her business as another name.
  { id: 'planner', householdId: 'h15', firstName: 'Michelle Elaine', lastName: 'Sunder', alternateNames: ['Bustle & Lace'] },
];
const surnames = householdSurnamesOf(LIST);
const CANDIDATES = LIST.map((g) => ({ ...g, householdSurnames: surnames.get(g.id) ?? [] }));
/** Who a profile signs in as, the way sign-in decides it: one person, well enough matched. `review:` is offered to the couple and signs in nobody. */
const findIn = (list: G[]) => {
  const names = householdSurnamesOf(list);
  const candidates = list.map((g) => ({ ...g, householdSurnames: names.get(g.id) ?? [] }));
  return (profile: ProviderProfileName) => {
    const r = matchGuestsByName(profile, candidates);
    if (r.confidence === 'none') return 'none';
    if (r.confidence === 'ambiguous') return `ambiguous:${r.matches.map((m) => m.id).sort().join('+')}`;
    return r.rank !== null && r.rank > SIGN_IN_MAX_RANK ? `review:${r.matches[0]!.id}` : r.matches[0]!.id;
  };
};
const find = findIn(LIST);
/** A profile as Google and Facebook send it (given and family fields), and as a display name only. */
const both = (given: string, family: string): ProviderProfileName[] => [{ givenName: given, familyName: family, name: `${given} ${family}` }, { name: `${given} ${family}` }];

describe('S-17: either guest on a line signs in under their own name', () => {
  it.each([
    ['Alma', 'Jarvik', 'alma'],
    ['Jody', "O'Brennan", 'jody'],
    ['Bram', 'Fitzwilliam', 'bram'],
    ['Nora', 'Fitzwilliam', 'nora'],
    ['Neal', 'Kendall', 'neal'],
    ['Mara', 'Barnaby', 'mara'],
    ['Corin', 'Le Marchand', 'corin'],
    ['Janet', 'Marlow', 'janet'],
    ['Justin', 'Feng', 'justin'],
    ['Colleen', 'Rockwell', 'colleen'],
  ])('%s %s', (given, family, id) => {
    for (const p of both(given, family)) expect(find(p), JSON.stringify(p)).toBe(id);
  });

  it('S-27: however the surname is typed: apostrophes, spacing, run together or apart, case, accents, a title', () => {
    for (const name of ["Jody O'Brennan", 'Jody O’Brennan', 'Jody OBrennan', 'Jody O Brennan', 'JODY O’BRENNAN', 'jody obrennan', 'Dr. Jody O’Brennan', '  Jody   O’Brennan  ']) expect(find({ name }), name).toBe('jody');
    for (const name of ['Corin Le Marchand', 'Corin LeMarchand', 'Corin Lemarchand', 'Corin le marchand', 'Corin Marchand', 'Córin Le Marchand']) expect(find({ name }), name).toBe('corin');
    expect(find({ givenName: 'Corin', familyName: 'Le Marchand' })).toBe('corin');
  });

  it('a surname first, with a comma, is read as that', () => {
    expect(find({ name: 'Fitzwilliam, Bram' })).toBe('bram');
    // Without the comma the order stands as written: "Fitzwilliam Bram" is not Bram Fitzwilliam.
    expect(find({ name: 'Fitzwilliam Bram' })).toBe('none');
  });
});

describe('S-18: a couple under two surnames: either may go by the other’s', () => {
  it.each([
    ['Alma', "O'Brennan", 'alma'],
    ['Jody', 'Jarvik', 'jody'],
    ['Alma', "Jarvik-O'Brennan", 'alma'],
    ['Jody', "O'Brennan Jarvik", 'jody'],
    ['Alma', "O'Brennan-Jarvik", 'alma'],
    ['Janet', 'Fitzwilliam-Marlow', 'janet'],
    ['Corin', 'Barnaby', 'corin'],
  ])('%s %s', (given, family, id) => {
    for (const p of both(given, family)) expect(find(p), JSON.stringify(p)).toBe(id);
  });

  it('a maiden name kept as a middle name still finds them', () => {
    expect(find({ name: 'Jody OBrennan Jarvik' })).toBe('jody');
    expect(find({ givenName: 'Jody OBrennan', familyName: 'Jarvik' })).toBe('jody');
  });

  it('never reaches into another household: the surname has to be one they are listed with', () => {
    for (const name of ['Alma Fitzwilliam', 'Jody Kendall', 'Sara Kendall', 'Bram Jarvik', 'Mara Fitzwilliam', 'Justin Fox']) expect(find({ name }), name).toBe('none');
  });

  it('S-22 S-23: the person named exactly wins; a profile two guests fit equally signs in neither', () => {
    // Jan Fitzwilliam is on a line of her own; Janet (Marlow) shares a household with a Fitzwilliam.
    expect(find({ name: 'Jan Fitzwilliam' })).toBe('jan');
    // "Janet Fitzwilliam" could be Janet under her partner's name, or Jan under a longer form of hers: nobody is signed in.
    expect(find({ name: 'Janet Fitzwilliam' })).toBe('ambiguous:jan+janet');
  });
});

describe('S-19: a maiden name on record', () => {
  it.each(['Nora Halloran', 'Nora Halloran Fitzwilliam', 'Nora Halloran-Fitzwilliam', 'Nora Fitzwilliam Halloran', 'Nora Fitzwilliam'])('%s', (name) => {
    expect(find({ name })).toBe('nora');
  });

  it('given as the surname alone works the same', () => {
    const nora = { id: 'n', firstName: 'Nora', lastName: 'Fitzwilliam', alternateNames: ['Halloran'] };
    expect(matchGuestsByName({ givenName: 'Nora', familyName: 'Halloran' }, [nora]).confidence).toBe('one');
    // The word alone is not a person: a profile called only "Halloran" matches nobody.
    expect(matchGuestsByName({ name: 'Halloran' }, [nora]).confidence).toBe('none');
  });

  it('is hers only: her husband is not found under it', () => {
    expect(find({ name: 'Bram Halloran' })).toBe('none');
  });
});

describe('a guest listed by first name', () => {
  it('S-20: is found through the surname of the person they are listed with', () => {
    for (const p of both('Tilly', 'Kendall')) expect(find(p)).toBe('tilly');
    expect(matchRank({ name: 'Tilly Kendall' }, CANDIDATES.find((c) => c.id === 'tilly')!)).toBe(2);
  });

  it('S-20 S-21: and under no other surname: a first name is not enough to sign anyone in', () => {
    for (const name of ['Tilly Jones', 'Tilly', 'Mick Jagger', 'Mick', 'Christa Mick', 'Christa']) expect(find({ name }), name).toBe('none');
    expect(find({ givenName: 'Tilly' })).toBe('none');
  });

  it('S-21: a line that names a relation, not a person, matches nobody by name', () => {
    for (const name of ['Ruth Winslow', 'Grandma', 'Winslow']) expect(find({ name }), name).toBe('none');
    // Signed in as the couple wrote her down, she is herself.
    expect(find({ name: 'Grandma Winslow' })).toBe('grandma');
  });
});

describe('two guests one name could be', () => {
  it('signs in neither, and says who they were', () => {
    for (const p of both('Barton', 'Barnaby')) expect(find(p)).toBe('ambiguous:barton1+barton2');
  });

  it('a shared first name with different surnames is nobody’s problem', () => {
    expect(find({ name: 'Sara Fox' })).toBe('sara-fox');
    expect(find({ name: 'Sarah Feng' })).toBe('sara-feng');
    expect(find({ name: 'Sara Oswald' })).toBe('sara-oswald');
    expect(find({ name: 'Sara Smith' })).toBe('none');
  });
});

describe('short forms, spellings and slips', () => {
  it('a short form or another spelling of the given name', () => {
    for (const name of ['Mike Rockwell', 'Mikey Rockwell', 'Michael Rockwell']) expect(find({ name }), name).toBe('michael');
    expect(sameGivenName('pat', 'patrick')).toBe(true);
    expect(sameGivenName('pat', 'patricia')).toBe(true);
    // Sharing a short form does not make two names one.
    expect(sameGivenName('patrick', 'patricia')).toBe(false);
    expect(sameGivenName('kate', 'katelyn')).toBe(true);
    expect(sameGivenName('katherine', 'katelyn')).toBe(false);
  });

  it('one letter out, on our side or theirs', () => {
    // The list has "Bondrell"; her profile has it spelled right.
    expect(find({ name: 'Dinah Boudrell' })).toBe('dinah');
    // A given name one letter out is offered to the couple and signs in nobody: it is as often another person.
    expect(find({ name: 'Dinnah Bondrell' })).toBe('review:dinah');
    expect(find({ name: 'Colleen Rockwel' })).toBe('colleen');
  });

  it('S-24: but never on a short name, where one letter is another person', () => {
    for (const name of ['Dan Fitzwilliam', 'Jon Fitzwilliam', 'Sara Fax', 'Sara Fang', 'Brom Fitzwilliam', 'Mora Barnaby']) expect(find({ name }), name).toBe('none');
    // Another spelling of the given name is the same name, with or without a slip in the surname.
    expect(find({ name: 'Neil Kendall' })).toBe('neal');
    // Another spelling and a slip in the surname together are two doubts: offered to the couple, not signed in.
    expect(find({ name: 'Neil Kendal' })).toBe('review:neal');
    expect(find({ name: 'Neal Kendal' })).toBe('neal');
  });

  it('two letters out is somebody else', () => {
    expect(find({ name: 'Dinah Bonderlux' })).toBe('none');
    expect(find({ name: 'Colin Rockwell' })).toBe('none');
  });
});

describe('S-26: the wedding planner', () => {
  const planner = CANDIDATES.find((c) => c.id === 'planner')!;

  it.each<ProviderProfileName>([
    { givenName: 'Michelle', familyName: 'Sunder' },
    { givenName: 'Michelle', familyName: 'Sunder', name: 'Michelle Sunder' },
    { name: 'Michelle Sunder' },
    { name: 'Michelle Elaine Sunder' },
    { name: 'Michelle E. Sunder' },
    { name: 'Michelle E Sunder' },
    { givenName: 'Michelle Elaine', familyName: 'Sunder' },
    { givenName: 'Michelle E.', familyName: 'Sunder' },
    { name: 'MICHELLE SUNDER' },
    { name: 'michelle sunder' },
    { name: 'Michele Sunder' },
    { name: 'Shelly Sunder' },
    { name: 'Michelle Sunder-Reyes' },
    { name: 'Michelle Sunder | Bustle & Lace' },
    { name: 'Michelle Sunder (Bustle & Lace)' },
    { name: 'Michelle Sunder - Wedding Planner' },
    { name: 'Michelle Sunder, CPA' },
    { name: 'Sunder, Michelle' },
    { name: 'Elaine Sunder' },
    { name: 'Michelle Sundar' },
    { name: 'Bustle & Lace' },
    { name: 'Bustle and Lace' },
    { givenName: 'Bustle', familyName: '& Lace', name: 'Bustle & Lace' },
    { name: 'Michelle @ Bustle & Lace' },
    // The business under a longer name is still the business.
    { name: 'Bustle & Lace Events' },
  ])('signs in as %j', (profile) => {
    expect(find(profile)).toBe('planner');
  });

  it('whichever way her own record is written', () => {
    for (const record of [
      { firstName: 'Michelle', lastName: 'Sunder' },
      { firstName: 'Michelle Elaine', lastName: 'Sunder' },
      { firstName: 'Michelle E.', lastName: 'Sunder' },
    ]) {
      for (const profile of [{ name: 'Michelle Sunder' }, { name: 'Michelle Elaine Sunder' }, { name: 'Michelle E. Sunder' }, { givenName: 'Michelle', familyName: 'Sunder' }]) {
        expect(namesMatch(profile, record), `${JSON.stringify(profile)} vs ${JSON.stringify(record)}`).toBe(true);
      }
    }
  });

  it.each(['Michelle', 'Sunder', 'M Sunder', 'Michelle Smith', 'Michael Sunder', 'Bustle', 'Lace & Bustle', 'Lace Events', 'Rochelle Sunder', 'Michelle Saunders'])('does not sign in %s as her', (name) => {
    expect(matchRank({ name }, planner)).toBeNull();
  });
});

describe('profiles as the providers send them', () => {
  it('S-25: decoration around a name is set aside', () => {
    for (const name of ['Bram Fitzwilliam 🎉', 'Bram Fitzwilliam (he/him)', 'Bram Fitzwilliam | Acme Co', 'Bram Fitzwilliam - Acme Co', 'Bram Fitzwilliam · Photographer', 'Mr. Bram Fitzwilliam Jr.']) expect(find({ name }), name).toBe('bram');
  });

  it('a hyphenated given name is not decoration', () => {
    const p = parseProviderProfile({ name: 'Mary-Ann Fitzwilliam' });
    expect(p.given).toEqual(['mary', 'ann']);
    expect(p.family).toEqual(['fitzwilliam']);
  });

  it('a whole name typed into one field is read as a whole name', () => {
    expect(find({ givenName: 'Bram Fitzwilliam' })).toBe('bram');
    expect(find({ givenName: 'Bram Fitzwilliam', name: 'Bram Fitzwilliam' })).toBe('bram');
  });

  it('nothing usable matches nobody and throws nothing', () => {
    for (const p of [{}, { name: '' }, { name: '   ' }, { name: '🎉' }, { name: '-' }, { name: '&' }, { givenName: null, familyName: null, name: null }, { name: 'x'.repeat(5000) }, { name: '张伟' }, { name: 'null null' }]) expect(find(p as ProviderProfileName), JSON.stringify(p).slice(0, 40)).toBe('none');
  });
});

describe('the surnames of a household', () => {
  it('are every other named adult’s, and never their own alone', () => {
    expect(surnames.get('alma')).toEqual(["O'Brennan"]);
    expect(surnames.get('jody')).toEqual(['Jarvik']);
    expect(surnames.get('tilly')).toEqual(['Kendall']);
    expect(surnames.get('neal')).toEqual([]);
    expect(surnames.get('mick')).toEqual([]);
    expect(surnames.get('bram')).toEqual(['Fitzwilliam']);
  });
});

describe('names that must not sign in the wrong person', () => {
  it('S-19 S-22: a maiden name on one record never outranks the guest listed under that very name', () => {
    const who = findIn([
      { id: 'jane-smythe', householdId: 'a', firstName: 'Jane', lastName: 'Smythe', alternateNames: ['Jane Dorrow'] },
      { id: 'jane-dorrow', householdId: 'b', firstName: 'Jane', lastName: 'Dorrow' },
    ]);
    // Two people answer to it equally: neither is signed in. Each is still found under a name only they have.
    expect(who({ name: 'Jane Dorrow' })).toBe('ambiguous:jane-dorrow+jane-smythe');
    expect(who({ givenName: 'Jane', familyName: 'Dorrow' })).toBe('ambiguous:jane-dorrow+jane-smythe');
    expect(who({ name: 'Jane Smythe' })).toBe('jane-smythe');
    expect(who({ name: 'Jane Dorrow Smythe' })).toBe('jane-smythe');
  });

  it('S-25: what sits in brackets after a name that already fits someone is ignored', () => {
    const who = findIn([
      { id: 'kim', householdId: 'a', firstName: 'Kim', lastName: 'Parkes' },
      { id: 'florist', householdId: 'b', firstName: 'Petra', lastName: 'Lindqvist', alternateNames: ['Petal & Twine'] },
    ]);
    expect(who({ name: 'Kim Parkes (Petal & Twine)' })).toBe('kim');
    expect(who({ name: 'Kim Parkes | Petal & Twine' })).toBe('kim');
    // Alone, or after a name that fits nobody, the other name is whose it is.
    expect(who({ name: 'Petal & Twine' })).toBe('florist');
    expect(who({ name: 'Petal and Twine' })).toBe('florist');
  });

  it('S-22: a middle name that is someone else’s surname does not beat the profile’s own surname', () => {
    const who = findIn([
      { id: 'jim', householdId: 'a', firstName: 'Jim', lastName: 'Harlowe' },
      { id: 'james-scott', householdId: 'b', firstName: 'James', lastName: 'Scott' },
    ]);
    expect(who({ givenName: 'James Scott', familyName: 'Harlowe' })).toBe('jim');
    expect(who({ name: 'James Scott Harlowe' })).toBe('jim');
    expect(who({ name: 'James Scott' })).toBe('james-scott');
  });

  it('S-24: a given name one letter out is another person as often as a slip: offered to the couple, never signed in', () => {
    const who = findIn([
      { id: 'frances', householdId: 'a', firstName: 'Frances', lastName: 'Doyland' },
      { id: 'maria', householdId: 'b', firstName: 'Maria', lastName: 'Quenby' },
      { id: 'karin', householdId: 'c', firstName: 'Karin', lastName: 'Larsen' },
    ]);
    expect(who({ name: 'Francis Doyland' })).toBe('review:frances');
    expect(who({ name: 'Mario Quenby' })).toBe('review:maria');
    // Another spelling of the given name and a slip in the surname: two doubts, so offered, not signed in.
    expect(who({ name: 'Karen Larson' })).toBe('review:karin');
    expect(who({ name: 'Karin Larson' })).toBe('karin');
    // A surname one letter out, with the given name right, is still a slip.
    expect(who({ name: 'Frances Doylend' })).toBe('frances');
  });

  it('a shared middle name is not a shared person', () => {
    const who = findIn([{ id: 'mary', householdId: 'a', firstName: 'Mary Katherine', lastName: 'Doyland' }]);
    expect(who({ name: 'Anne Katherine Doyland' })).toBe('none');
    expect(who({ givenName: 'Anne Katherine', familyName: 'Doyland' })).toBe('none');
    // Going by her middle name is her.
    expect(who({ name: 'Katherine Doyland' })).toBe('mary');
    expect(who({ name: 'Mary Doyland' })).toBe('mary');
  });

  it('a surname that is also a particle is still a surname', () => {
    const who = findIn([
      { id: 'linh', householdId: 'a', firstName: 'Linh', lastName: 'Le' },
      { id: 'minh', householdId: 'b', firstName: 'Minh', lastName: 'Van' },
    ]);
    expect(who({ name: 'Linh Le' })).toBe('linh');
    expect(who({ givenName: 'Minh', familyName: 'Van' })).toBe('minh');
    expect(who({ name: 'Linh Van' })).toBe('none');
  });

  it('a father and son are two people', () => {
    const who = findIn([
      { id: 'senior', householdId: 'a', firstName: 'Corwin', lastName: 'Zarkov Sr.' },
      { id: 'junior', householdId: 'b', firstName: 'Corwin', lastName: 'Zarkov Jr.' },
    ]);
    // A profile rarely carries the suffix: without it, it could be either, and signs in neither.
    expect(who({ name: 'Corwin Zarkov' })).toBe('ambiguous:junior+senior');
  });

  it('S-22: a guest named exactly does not beat a relative whose name is a short or long form of it', () => {
    const who = findIn([
      { id: 'chris', householdId: 'a', firstName: 'Chris', lastName: 'Millwick' },
      { id: 'christine', householdId: 'a', firstName: 'Christine', lastName: 'Millwick' },
      { id: 'sam', householdId: 'b', firstName: 'Sam', lastName: 'Cartwell' },
      { id: 'samantha', householdId: 'c', firstName: 'Samantha', lastName: 'Cartwell' },
      { id: 'sam-other', householdId: 'd', firstName: 'Sam', lastName: 'Ellery' },
    ]);
    // The sheet writes what the couple call someone; a profile writes what they call themselves.
    expect(who({ name: 'Chris Millwick' })).toBe('ambiguous:chris+christine');
    expect(who({ name: 'Christine Millwick' })).toBe('ambiguous:chris+christine');
    expect(who({ givenName: 'Sam', familyName: 'Cartwell' })).toBe('ambiguous:sam+samantha');
    // A short form under another surname is nobody's rival.
    expect(who({ name: 'Sam Ellery' })).toBe('sam-other');
    expect(who({ name: 'Samantha Ellery' })).toBe('sam-other');
  });

  it('a name that is two people’s is nobody’s own', () => {
    const who = findIn([
      { id: 'tom', householdId: 'a', firstName: 'Tom', lastName: 'Bakewell' },
      { id: 'mary', householdId: 'a', firstName: 'Mary', lastName: 'Bakewell' },
    ]);
    for (const name of ['Tom & Mary Bakewell', 'Tom and Mary Bakewell', 'Mary + Tom Bakewell']) expect(who({ name }), name).toBe('none');
    expect(who({ givenName: 'Tom & Mary', familyName: 'Bakewell' })).toBe('none');
    // Written without spaces, or all typed into the surname box.
    expect(who({ name: 'Tom&Mary Bakewell' })).toBe('none');
    expect(who({ familyName: 'Tom & Mary Bakewell' })).toBe('none');
    expect(who({ name: 'Tom Bakewell' })).toBe('tom');
  });

  it('a profile that says which of a father and son it is finds that one, and never the other', () => {
    const who = findIn([
      { id: 'senior', householdId: 'a', firstName: 'Corwin', lastName: 'Zarkov Sr.' },
      { id: 'junior', householdId: 'b', firstName: 'Corwin', lastName: 'Zarkov Jr.' },
    ]);
    expect(who({ name: 'Corwin Zarkov Jr.' })).toBe('junior');
    expect(who({ name: 'Corwin Zarkov, Jr' })).toBe('junior');
    expect(who({ givenName: 'Corwin', familyName: 'Zarkov Sr' })).toBe('senior');
    expect(who({ name: 'Corwin Zarkov Senior' })).toBe('senior');
    expect(who({ name: 'Corwin Zarkov III' })).toBe('none');
    // Listed without it, beside a namesake of the surname listed with it: a profile that says "Jr." could be either.
    const mixed = findIn([
      { id: 'plain', householdId: 'a', firstName: 'Corwin', lastName: 'Zarkov' },
      { id: 'marked', householdId: 'b', firstName: 'Corey', lastName: 'Zarkov Jr.' },
    ]);
    expect(mixed({ name: 'Corwin Zarkov Jr.' })).toBe('ambiguous:marked+plain');
    expect(mixed({ name: 'Corwin Zarkov' })).toBe('plain');
  });

  it('a very long or bracket-heavy name costs nothing and matches nobody', () => {
    const many: G[] = Array.from({ length: 200 }, (_v, i) => ({ id: `g${i}`, householdId: `h${i}`, firstName: `Given${i}`, lastName: `Surname${i}` }));
    const who = findIn(many);
    const started = Date.now();
    expect(who({ name: '('.repeat(3000) })).toBe('none');
    expect(who({ name: `${'x'.repeat(50_000)} Surname7` })).toBe('none');
    expect(who({ givenName: 'Given7'.padEnd(5000, ' '), familyName: 'Surname7' })).toBe('g7');
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

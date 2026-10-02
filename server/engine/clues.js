// Clue templates. A clue is always generated from real traits: `trueClue` only ever says true
// things, `forgedClue` only ever says false things (used by the Witch's Curse).
// No clue ever states "X is the Witch" outright.

import { ROLE_INFO, traitsOf } from './roles.js';
import { pick, shuffle } from './util.js';

// test(role, traits) -> boolean. `yes` is shown when the test is true, `no` when false.
// `yesClaimsAligned` marks text that says the player serves the Witch (never forged against the Werewolf).
const FACTS = [
  {
    tier: 1,
    test: (role) => role !== 'witch',
    yes: (n) => `${n} is not the Witch.`,
  },
  {
    tier: 1,
    test: (_, t) => t.supernatural,
    yes: (n) => `${n} is supernatural.`,
    no: (n) => `${n} is entirely human.`,
  },
  {
    tier: 1,
    test: (_, t) => t.darkMagic,
    yes: (n) => `Dark magic surrounds ${n}.`,
    no: (n) => `No dark magic clings to ${n}.`,
  },
  {
    tier: 1,
    test: (_, t) => t.investigative,
    yes: (n) => `${n} has an investigative gift.`,
    no: (n) => `${n} has no gift for seeing hidden things.`,
  },
  {
    tier: 1,
    test: (_, t) => t.unstable,
    yes: (n) => `${n}'s identity appears unstable.`,
    no: (n) => `${n} wears only one shape.`,
  },
  {
    tier: 2,
    test: (_, t) => t.aligned,
    yes: (n) => `${n} is aligned with the Witch.`,
    no: (n) => `${n} is not aligned with the Witch.`,
    yesClaimsAligned: true,
  },
  {
    tier: 2,
    test: (_, t) => t.supernatural && !t.aligned,
    yes: (n) => `${n} is supernatural, but does not serve the Witch.`,
  },
  {
    tier: 2,
    test: (_, t) => !t.supernatural && !t.aligned,
    yes: (n) => `${n} is human and does not serve the Witch.`,
  },
  {
    tier: 2,
    test: (_, t) => t.aligned && t.darkMagic,
    yes: (n) => `${n} carries dark magic and walks in the Witch's shadow.`,
    yesClaimsAligned: true,
  },
];

function roleLabel(role) {
  return role === 'villager' ? 'a Villager' : `the ${ROLE_INFO[role].name}`;
}

// "X is either the Medium or a Villager." Never mentions the Witch, never used on the Witch.
function rolePairClue(name, trueRole, rolesInPlay, rng, forged) {
  const others = rolesInPlay.filter((r) => r !== 'witch' && r !== trueRole);
  const unique = [...new Set(others)];
  if (forged) {
    // A forgery must never paint the Werewolf as Witch-aligned.
    const decoys = trueRole === 'werewolf' ? unique.filter((r) => r !== 'familiar') : unique;
    if (decoys.length < 2) return null;
    const [a, b] = shuffle(decoys, rng);
    return `${name} is either ${roleLabel(a)} or ${roleLabel(b)}.`;
  }
  if (trueRole === 'witch' || unique.length === 0) return null;
  const [a, b] = shuffle([trueRole, pick(unique, rng)], rng);
  return `${name} is either ${roleLabel(a)} or ${roleLabel(b)}.`;
}

function tierForRound(round) {
  return round <= 1 ? 1 : 2;
}

export function trueClue(target, round, rolesInPlay, rng = Math.random) {
  const tier = tierForRound(round);
  const t = traitsOf(target.role);
  const options = [];
  for (const f of FACTS.filter((f) => f.tier === tier)) {
    const value = f.test(target.role, t);
    if (value && f.yes) options.push(f.yes(target.name));
    if (!value && f.no) options.push(f.no(target.name));
  }
  if (tier === 2) {
    const pair = rolePairClue(target.name, target.role, rolesInPlay, rng, false);
    if (pair) options.push(pair);
  }
  return pick(options, rng);
}

export function forgedClue(target, round, rolesInPlay, rng = Math.random) {
  const tier = tierForRound(round);
  const t = traitsOf(target.role);
  const options = [];
  for (const f of FACTS.filter((f) => f.tier === tier)) {
    const value = f.test(target.role, t);
    if (!value && f.yes && !(f.yesClaimsAligned && target.role === 'werewolf')) options.push(f.yes(target.name));
    if (value && f.no) options.push(f.no(target.name));
  }
  if (tier === 2) {
    const pair = rolePairClue(target.name, target.role, rolesInPlay, rng, true);
    if (pair) options.push(pair);
  }
  return options.length ? pick(options, rng) : null;
}

// An ordinary Curse: the information stays technically true but arrives damaged.
export function garble(text, rng = Math.random) {
  const words = text.replace(/\.$/, '').split(' ');
  const styles = [
    () => `The vision flickers… “${words.slice(0, Math.ceil(words.length / 2)).join(' ')}…” and then it is gone.`,
    () => `Whispers overlap: “${text}” — or was it the reverse?`,
    () => `Through the smoke, backwards: “${[...words].reverse().join(' ')}.”`,
  ];
  return pick(styles, rng)();
}

export function trueScryClue(target) {
  const t = traitsOf(target.role);
  if (t.aligned) return `${target.name} is aligned with the Witch.`;
  if (t.supernatural) return `${target.name} is supernatural, but not aligned with the Witch.`;
  return `${target.name} is innocent of witchcraft.`;
}

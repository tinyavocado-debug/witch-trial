// The Medium's Vision: a cryptic, truthful hint about the Witch (or a false one under the Witch's Curse).

import { pick, sample, shuffle } from './util.js';

const SPELL_NAMES = { scry: 'Scry', curse: 'Curse', trueScry: 'Scry', vision: 'Scry' };

function listNames(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

// context: { round, witchLastSpell, witchFirstVoteName }
export function visionClue({ players, medium, round, witchLastSpell, witchFirstVoteName }, rng = Math.random, forged = false) {
  const witch = players.find((p) => p.role === 'witch');
  const others = players.filter((p) => p.id !== witch.id && p.id !== medium.id);
  const lineupSize = round >= 3 ? 2 : 3;
  const options = [];

  if (!forged) {
    if (others.length >= lineupSize - 1) {
      const lineup = shuffle([witch, ...sample(others, lineupSize - 1, rng)], rng).map((p) => p.name);
      options.push(`The Witch walks among ${listNames(lineup)}.`);
    }
    const letters = [...new Set(witch.name.toUpperCase().replace(/[^A-Z]/g, ''))];
    const telling = letters.filter((l) => !players.every((p) => p.name.toUpperCase().includes(l)));
    if (telling.length) options.push(`The Witch's name holds the letter “${pick(telling, rng)}”.`);
    if (witchLastSpell) options.push(`Last round, the Witch cast ${SPELL_NAMES[witchLastSpell]}.`);
    if (witchFirstVoteName) options.push(`At the First Trial, the Witch's vote fell on ${witchFirstVoteName}.`);
  } else {
    if (others.length >= lineupSize) {
      const lineup = sample(others, lineupSize, rng).map((p) => p.name);
      options.push(`The Witch walks among ${listNames(lineup)}.`);
    }
    const lies = ['Scry', 'Curse'].filter((s) => s !== SPELL_NAMES[witchLastSpell]);
    options.push(`Last round, the Witch cast ${pick(lies, rng)}.`);
  }

  if (!options.length) return 'The mists are thick. You glimpse only a crooked hat.';
  return pick(options, rng);
}

// Resolves one Spell Round. Order: Curses → investigations (Scry, True Scry, Vision) →
// what each non-Witch Curse revealed to its caster → what the Witch's Curse revealed.

import { forgedClue, garble, trueClue, trueScryClue } from './clues.js';
import { visionClue } from './vision.js';
import { curseReading, witchCurseReading } from './readings.js';

export const SPELLS = {
  scry: { label: 'Scry', targets: 1, desc: 'Investigate a player. Receive one truthful clue about them.' },
  curse: { label: 'Curse', targets: 1, desc: 'Curse another player.' },
  trueScry: { label: 'True Scry', targets: 1, desc: 'Once per game. A reading no Curse can corrupt.' },
  vision: { label: 'Vision', targets: 0, desc: 'Once, in Round 2 or 3. A cryptic glimpse of the Witch.' },
};

const WITCH_FORGE_CHANCE = 0.7;

/**
 * @param {object} args
 * @param {number} args.round
 * @param {Array<{id,name,role,alive}>} args.players
 * @param {Record<string,{type:string,targets:string[]}>} args.actions  keyed by caster id
 * @param {object} args.visionContext  { witchLastSpell, witchFirstVoteName }
 * @returns {{ results: Record<string,Array<{round,kind,text}>> }}
 */
export function resolveRound({ round, players, actions, visionContext = {} }, rng = Math.random) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const rolesInPlay = players.map((p) => p.role);
  const results = {};
  const give = (id, kind, text) => (results[id] ??= []).push({ round, kind, text });

  // 1. Curses
  const curses = {};
  for (const [casterId, a] of Object.entries(actions)) {
    if (a.type !== 'curse') continue;
    const c = (curses[a.targets[0]] ??= { witch: false });
    if (byId[casterId].role === 'witch') c.witch = true;
  }

  // Applies a Curse on the *recipient* of information, remembering who was affected.
  const corrupted = new Set();
  const corrupt = (recipientId, truth, forge) => {
    const curse = curses[recipientId];
    if (!curse) return truth;
    corrupted.add(recipientId);
    if (curse.witch && rng() < WITCH_FORGE_CHANCE) {
      const lie = forge();
      if (lie) return lie;
    }
    return garble(truth, rng);
  };

  // 2. Investigations
  for (const [casterId, a] of Object.entries(actions)) {
    const caster = byId[casterId];
    if (a.type === 'scry') {
      const target = byId[a.targets[0]];
      const text = corrupt(casterId, trueClue(target, round, rolesInPlay, rng), () => forgedClue(target, round, rolesInPlay, rng));
      give(casterId, 'scry', text);
    } else if (a.type === 'trueScry') {
      give(casterId, 'trueScry', `True Scry: ${trueScryClue(byId[a.targets[0]])}`);
    } else if (a.type === 'vision') {
      const ctx = { players, medium: caster, round, ...visionContext };
      const text = corrupt(casterId, visionClue(ctx, rng, false), () => visionClue(ctx, rng, true));
      give(casterId, 'vision', `Vision: ${text}`);
    }
  }

  // 3. Every non-Witch Curse also quietly tells its caster something (and can itself be cursed).
  for (const [casterId, a] of Object.entries(actions)) {
    if (a.type !== 'curse' || byId[casterId].role === 'witch') continue;
    const reading = curseReading({ caster: byId[casterId], target: byId[a.targets[0]], actions, byId, players, rng });
    give(casterId, 'curse', corrupt(casterId, reading.truth, reading.forge));
  }

  // 4. The Witch learns whether her Curse corrupted anything, so it resolves last.
  for (const [casterId, a] of Object.entries(actions)) {
    if (a.type !== 'curse' || byId[casterId].role !== 'witch') continue;
    const target = byId[a.targets[0]];
    const reading = witchCurseReading(target.name, corrupted.has(target.id));
    give(casterId, 'curse', corrupt(casterId, reading.truth, reading.forge));
  }

  return { results };
}

// What each role quietly learns when they cast a Curse. Every Curse is just "Curse" on the phone;
// it still interferes with the target (garbled, or forged for the Witch), and the caster also
// receives a reading that depends on their role:
//   Witch: whether her Curse corrupted a result      Familiar: who/what the target's magic concerned
//   Werewolf: investigative magic, disruptive, or neither   Witch Hunter: whether another Curse hit the target
//   Medium: whether supernatural magic was around the target   Villager: sought info, interfered, or nothing
// Each reading returns { truth, forge }: the true text, and a function producing a false one.

import { traitsOf } from './roles.js';
import { pick } from './util.js';

// Scry, True Scry and Vision seek information; a Curse disrupts it.
export function magicKind(action) {
  if (!action) return 'none';
  return ['scry', 'trueScry', 'vision'].includes(action.type) ? 'investigative' : 'disruptive';
}

const HUNT_TEXT = {
  investigative: (n) => `${n} used investigative magic.`,
  disruptive: (n) => `${n} used disruptive magic.`,
  none: (n) => `${n} used neither investigative nor disruptive magic.`,
};

const WATCH_TEXT = {
  investigative: (n) => `${n} sought information.`,
  disruptive: (n) => `${n} interfered with magic.`,
  none: (n) => `Nothing unusual: ${n} did not work any magic.`,
};

/**
 * Builds the reading for a non-Witch Curse. The Witch's reading is resolved separately, after
 * every other result, because it reports whether it corrupted anything.
 * ctx: { caster, target, actions, byId, players, rng }
 */
export function curseReading(ctx) {
  const { caster, target, actions, byId, players, rng } = ctx;
  const theirs = actions[target.id];
  const n = target.name;
  // Everyone else's spells this round (a caster's own Curse never shows up in their reading).
  const othersSpells = Object.entries(actions).filter(([casterId]) => casterId !== caster.id);

  switch (caster.role) {
    case 'familiar': {
      const subject = whisperSubject(theirs, ctx);
      const truth = subject
        ? `What ${n} learned this round concerned ${subject}.`
        : `${n} worked no magic this round; nothing they learned concerned anyone.`;
      const forge = () => {
        const decoys = players.filter((p) => p.id !== target.id && !(subject ?? '').includes(p.name));
        return decoys.length ? `What ${n} learned this round concerned ${pick(decoys, rng).name}.` : null;
      };
      return { truth, forge };
    }
    case 'werewolf': {
      const kind = magicKind(theirs);
      return {
        truth: HUNT_TEXT[kind](n),
        forge: () => HUNT_TEXT[pick(Object.keys(HUNT_TEXT).filter((k) => k !== kind), rng)](n),
      };
    }
    case 'villager': {
      const kind = magicKind(theirs);
      return {
        truth: WATCH_TEXT[kind](n),
        forge: () => WATCH_TEXT[pick(Object.keys(WATCH_TEXT).filter((k) => k !== kind), rng)](n),
      };
    }
    case 'hunter': {
      // Another player's Curse landed on the target (the Hunter's own Curse doesn't count).
      const touched = othersSpells.some(([, a]) => magicKind(a) === 'disruptive' && a.targets.includes(target.id));
      const yes = `Disruptive or corrupted magic touched ${n} this round.`;
      const no = `No disruptive or corrupted magic touched ${n} this round.`;
      return { truth: touched ? yes : no, forge: () => (touched ? no : yes) };
    }
    case 'medium': {
      // A supernatural player's spell (other than the Medium's own) was cast by or at the target.
      const active = othersSpells.some(([casterId, a]) =>
        traitsOf(byId[casterId].role).supernatural && (casterId === target.id || a.targets.includes(target.id)));
      const yes = `Supernatural magic stirred around ${n} this round.`;
      const no = `No supernatural magic stirred around ${n} this round.`;
      return { truth: active ? yes : no, forge: () => (active ? no : yes) };
    }
    default:
      return null;
  }
}

// Who or what the target's own magic this round was about.
function whisperSubject(action, { byId }) {
  if (!action) return null;
  return action.type === 'vision' ? 'the Witch' : byId[action.targets[0]].name;
}

export function witchCurseReading(targetName, affected) {
  const yes = `Your Curse twisted what ${targetName} learned this round.`;
  const no = `Your Curse found nothing to twist: ${targetName} received no magic it could corrupt.`;
  return { truth: affected ? yes : no, forge: () => (affected ? no : yes) };
}

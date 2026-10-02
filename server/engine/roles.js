import { shuffle } from './util.js';

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;

export const ROLE_INFO = {
  witch: {
    name: 'Witch',
    team: 'witch',
    traits: { supernatural: true, aligned: true, darkMagic: true, investigative: false, unstable: false },
    goal: 'Survive the Final Trial. If you are condemned, the Village wins.',
    ability: 'Your Curse is especially potent: it can make your victim\'s magic lie to them outright.',
  },
  familiar: {
    name: 'Familiar',
    team: 'witch',
    traits: { supernatural: true, aligned: true, darkMagic: true, investigative: false, unstable: false },
    goal: 'Protect the Witch. You win if the Witch survives.',
    ability: 'You secretly know who the Witch is. They do not know you. Lie, redirect suspicion, invent theories.',
  },
  werewolf: {
    name: 'Werewolf',
    team: 'werewolf',
    traits: { supernatural: true, aligned: false, darkMagic: false, investigative: false, unstable: true },
    goal: 'You win only if you are never condemned AND the Witch Hunter is condemned at any trial.',
    ability: 'You are supernatural but not allied with the Witch. Magic may find you suspicious, but never Witch-aligned.',
  },
  hunter: {
    name: 'Witch Hunter',
    team: 'village',
    traits: { supernatural: false, aligned: false, darkMagic: false, investigative: true, unstable: false },
    goal: 'Help the village condemn the Witch.',
    ability: 'Once per game you may cast True Scry: a reading no Curse can corrupt.',
  },
  medium: {
    name: 'Medium',
    team: 'village',
    traits: { supernatural: true, aligned: false, darkMagic: false, investigative: true, unstable: false },
    goal: 'Help the village condemn the Witch.',
    ability: 'At each Séance you may ask the Ghosts one yes-or-no question aloud; only you will see their answers. Once, in Round 2 or 3, you may receive a Vision of the Witch.',
  },
  villager: {
    name: 'Villager',
    team: 'village',
    traits: { supernatural: false, aligned: false, darkMagic: false, investigative: false, unstable: false },
    goal: 'Help the village condemn the Witch.',
    ability: 'No special power, but you can still cast spells, bluff, accuse, and vote.',
  },
};

export function traitsOf(role) {
  return ROLE_INFO[role].traits;
}

export function rolesForCount(n) {
  const roles = ['witch', 'familiar', 'werewolf', 'hunter', 'medium'];
  while (roles.length < n) roles.push('villager');
  return roles;
}

// Returns { [playerId]: role }.
export function assignRoles(playerIds, rng = Math.random) {
  const roles = shuffle(rolesForCount(playerIds.length), rng);
  return Object.fromEntries(playerIds.map((id, i) => [id, roles[i]]));
}

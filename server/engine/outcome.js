import { ROLE_INFO } from './roles.js';

/**
 * @param {Array<{id,name,role,condemnedIn:number|null}>} players
 * @returns {{ village:boolean, witch:boolean, werewolf:boolean, players:Array }}
 */
export function evaluate(players) {
  const witch = players.find((p) => p.role === 'witch');
  const hunter = players.find((p) => p.role === 'hunter');
  const werewolf = players.find((p) => p.role === 'werewolf');

  const village = witch.condemnedIn != null;
  const witchTeam = !village;
  const werewolfWins = !!werewolf && werewolf.condemnedIn == null && !!hunter && hunter.condemnedIn != null;

  const won = (p) => {
    const team = ROLE_INFO[p.role].team;
    if (team === 'village') return village;
    if (team === 'witch') return witchTeam;
    return werewolfWins;
  };

  return {
    village,
    witch: witchTeam,
    werewolf: werewolfWins,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      roleName: ROLE_INFO[p.role].name,
      team: ROLE_INFO[p.role].team,
      fate: p.condemnedIn === 1 ? 'Condemned at the First Trial — became a Ghost'
        : p.condemnedIn === 2 ? 'Condemned at the Second Trial — became a Ghost'
        : p.condemnedIn === 3 ? 'Condemned at the Final Trial'
        : 'Survived',
      won: won(p),
    })),
  };
}

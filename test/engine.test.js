import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles, MAX_PLAYERS, MIN_PLAYERS, ROLE_INFO, rolesForCount, traitsOf } from '../server/engine/roles.js';
import { forgedClue, trueClue, trueScryClue } from '../server/engine/clues.js';
import { resolveRound } from '../server/engine/spells.js';
import { evaluate } from '../server/engine/outcome.js';
import { Game, SCHEDULE } from '../server/engine/game.js';
import { seeded } from '../server/engine/util.js';

const ROLES = Object.keys(ROLE_INFO);
const ALL_ROLES_IN_PLAY = ['witch', 'familiar', 'werewolf', 'hunter', 'medium', 'villager', 'villager'];

// --- roles ---

test('role assignment always includes the five required roles', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const roles = Object.values(assignRoles(ids, seeded(n)));
    assert.equal(roles.length, n);
    for (const r of ['witch', 'familiar', 'werewolf', 'hunter', 'medium']) {
      assert.equal(roles.filter((x) => x === r).length, 1, `${r} with ${n} players`);
    }
  }
  assert.deepEqual(rolesForCount(5), ['witch', 'familiar', 'werewolf', 'hunter', 'medium']);
  assert.deepEqual(rolesForCount(6), ['witch', 'familiar', 'werewolf', 'hunter', 'medium', 'villager']);
});

// --- clues ---

// Checks a clue's text against real traits by recognising each template.
function isTruthfulSingle(text, name, role) {
  const t = traitsOf(role);
  const checks = [
    [`${name} is not the Witch.`, role !== 'witch'],
    [`${name} is supernatural.`, t.supernatural],
    [`${name} is entirely human.`, !t.supernatural],
    [`Dark magic surrounds ${name}.`, t.darkMagic],
    [`No dark magic clings to ${name}.`, !t.darkMagic],
    [`${name} has an investigative gift.`, t.investigative],
    [`${name} has no gift for seeing hidden things.`, !t.investigative],
    [`${name}'s identity appears unstable.`, t.unstable],
    [`${name} wears only one shape.`, !t.unstable],
    [`${name} is aligned with the Witch.`, t.aligned],
    [`${name} is not aligned with the Witch.`, !t.aligned],
    [`${name} is supernatural, but does not serve the Witch.`, t.supernatural && !t.aligned],
    [`${name} is human and does not serve the Witch.`, !t.supernatural && !t.aligned],
    [`${name} carries dark magic and walks in the Witch's shadow.`, t.aligned && t.darkMagic],
  ];
  for (const [template, truth] of checks) if (text === template) return truth;
  const m = text.match(new RegExp(`^${name} is either (.+) or (.+)\\.$`));
  if (m) {
    const label = (r) => (r === 'villager' ? 'a Villager' : `the ${ROLE_INFO[r].name}`);
    return [m[1], m[2]].includes(label(role));
  }
  throw new Error(`Unrecognised clue: ${text}`);
}

test('scry clues are always truthful and never name the Witch outright', () => {
  const rng = seeded(1);
  for (const role of ROLES) {
    for (const round of [1, 2, 3]) {
      for (let i = 0; i < 200; i++) {
        const text = trueClue({ name: 'Ada', role }, round, ALL_ROLES_IN_PLAY, rng);
        assert.ok(isTruthfulSingle(text, 'Ada', role), `${role} R${round}: ${text}`);
        assert.doesNotMatch(text, /is the Witch\.|or the Witch\.|the Witch or /);
      }
    }
  }
});

test('forged clues are always false', () => {
  const rng = seeded(2);
  for (const role of ROLES) {
    for (const round of [1, 2]) {
      for (let i = 0; i < 200; i++) {
        const text = forgedClue({ name: 'Ada', role }, round, ALL_ROLES_IN_PLAY, rng);
        if (text) assert.equal(isTruthfulSingle(text, 'Ada', role), false, `${role} R${round}: ${text}`);
      }
    }
  }
});

test('the Werewolf never appears aligned with the Witch, even when forged', () => {
  const rng = seeded(3);
  const wolf = { name: 'Wolf', role: 'werewolf' };
  for (let i = 0; i < 500; i++) {
    for (const round of [1, 2, 3]) {
      const truth = trueClue(wolf, round, ALL_ROLES_IN_PLAY, rng);
      const forged = forgedClue(wolf, round, ALL_ROLES_IN_PLAY, rng);
      for (const text of [truth, forged]) {
        if (!text) continue;
        assert.doesNotMatch(text, /Witch's shadow/, text);
        if (/aligned with the Witch/.test(text)) assert.match(text, /not aligned/, text);
      }
      if (forged) assert.doesNotMatch(forged, /Familiar/, forged);
    }
  }
  assert.equal(trueScryClue(wolf), 'Wolf is supernatural, but not aligned with the Witch.');
});

test('True Scry reports the three categories', () => {
  assert.match(trueScryClue({ name: 'A', role: 'witch' }), /aligned with the Witch/);
  assert.match(trueScryClue({ name: 'A', role: 'familiar' }), /is aligned with the Witch/);
  assert.match(trueScryClue({ name: 'A', role: 'medium' }), /supernatural, but not aligned/);
  assert.match(trueScryClue({ name: 'A', role: 'villager' }), /innocent of witchcraft/);
  assert.match(trueScryClue({ name: 'A', role: 'hunter' }), /innocent of witchcraft/);
});

// --- spells ---

const PLAYERS = [
  { id: 'w', name: 'Wendy', role: 'witch', alive: true },
  { id: 'f', name: 'Fred', role: 'familiar', alive: true },
  { id: 'l', name: 'Lupin', role: 'werewolf', alive: true },
  { id: 'h', name: 'Hana', role: 'hunter', alive: true },
  { id: 'm', name: 'Mara', role: 'medium', alive: true },
  { id: 'v', name: 'Vic', role: 'villager', alive: true },
];

test('True Scry ignores even the Witch\'s Curse', () => {
  for (let seed = 0; seed < 50; seed++) {
    const { results } = resolveRound(
      {
        round: 1,
        players: PLAYERS,
        actions: { w: { type: 'curse', targets: ['h'] }, h: { type: 'trueScry', targets: ['f'] } },
      },
      seeded(seed),
    );
    assert.equal(results.h[0].text, 'True Scry: Fred is aligned with the Witch.');
  }
});

test('an ordinary Curse garbles, the Witch\'s Curse can forge', () => {
  let garbled = 0;
  let forged = 0;
  for (let seed = 0; seed < 100; seed++) {
    const r1 = resolveRound(
      { round: 1, players: PLAYERS, actions: { v: { type: 'curse', targets: ['m'] }, m: { type: 'scry', targets: ['h'] } } },
      seeded(seed),
    );
    if (/vision flickers|Whispers overlap|backwards/.test(r1.results.m[0].text)) garbled++;
    const r2 = resolveRound(
      { round: 1, players: PLAYERS, actions: { w: { type: 'curse', targets: ['m'] }, m: { type: 'scry', targets: ['h'] } } },
      seeded(seed),
    );
    const t = r2.results.m[0].text;
    if (!/vision flickers|Whispers overlap|backwards/.test(t) && !isTruthfulSingle(t, 'Hana', 'hunter')) forged++;
  }
  assert.equal(garbled, 100);
  assert.ok(forged > 40, `forged ${forged}`);
});

// --- Curse readings ---

const curseResult = (casterId, targetId, otherActions = {}, seed = 1) =>
  resolveRound(
    { round: 2, players: PLAYERS, actions: { [casterId]: { type: 'curse', targets: [targetId] }, ...otherActions } },
    seeded(seed),
  ).results[casterId][0].text;

test('a Villager\'s and Werewolf\'s Curse report what kind of magic the target used', () => {
  assert.equal(curseResult('v', 'h', { h: { type: 'scry', targets: ['w'] } }), 'Hana sought information.');
  assert.equal(curseResult('v', 'h', { h: { type: 'curse', targets: ['w'] } }), 'Hana interfered with magic.');
  assert.equal(curseResult('v', 'h'), 'Nothing unusual: Hana did not work any magic.');
  assert.equal(curseResult('l', 'm', { m: { type: 'vision', targets: [] } }), 'Mara used investigative magic.');
  assert.equal(curseResult('l', 'm', { m: { type: 'curse', targets: ['w'] } }), 'Mara used disruptive magic.');
  assert.equal(curseResult('l', 'm'), 'Mara used neither investigative nor disruptive magic.');
});

test('the Familiar\'s Curse learns who the target\'s magic concerned, not what they learned', () => {
  assert.equal(curseResult('f', 'h', { h: { type: 'scry', targets: ['w'] } }), 'What Hana learned this round concerned Wendy.');
  assert.equal(curseResult('f', 'm', { m: { type: 'vision', targets: [] } }), 'What Mara learned this round concerned the Witch.');
  assert.equal(curseResult('f', 'v', { v: { type: 'curse', targets: ['l'] } }), 'What Vic learned this round concerned Lupin.');
  assert.match(curseResult('f', 'v'), /worked no magic/);
});

test('the Witch Hunter\'s Curse detects another Curse on the target, ignoring its own', () => {
  assert.match(curseResult('h', 'v'), /^No disruptive/);
  assert.match(curseResult('h', 'v', { l: { type: 'curse', targets: ['v'] } }), /^Disruptive or corrupted magic touched Vic/);
  assert.match(curseResult('h', 'v', { m: { type: 'scry', targets: ['v'] } }), /^No disruptive/, 'a Scry is not disruptive');
});

test('the Medium\'s Curse detects supernatural magic around the target', () => {
  assert.match(curseResult('m', 'v'), /^No supernatural/);
  assert.match(curseResult('m', 'v', { h: { type: 'scry', targets: ['v'] } }), /^No supernatural/, 'the Hunter is human');
  assert.match(curseResult('m', 'v', { l: { type: 'scry', targets: ['v'] } }), /^Supernatural magic stirred around Vic/);
  assert.match(curseResult('m', 'f', { f: { type: 'scry', targets: ['h'] } }), /^Supernatural/, 'a supernatural target casting counts');
});

test('the Witch\'s Curse reports whether it corrupted a result', () => {
  assert.match(curseResult('w', 'h', { h: { type: 'scry', targets: ['v'] } }), /^Your Curse twisted what Hana learned/);
  assert.match(curseResult('w', 'h'), /^Your Curse found nothing to twist/);
  assert.match(curseResult('w', 'h', { h: { type: 'trueScry', targets: ['v'] } }), /found nothing/, 'True Scry resists the Curse');
  assert.match(curseResult('w', 'l', { l: { type: 'curse', targets: ['v'] } }), /twisted what Lupin learned/, 'another Curse reading can be corrupted');
});

test('a cursed caster\'s reading is itself corrupted', () => {
  // Vic (Villager) is cursed by Lupin: the reading arrives garbled but still true.
  const text = curseResult('v', 'h', { h: { type: 'scry', targets: ['w'] }, l: { type: 'curse', targets: ['v'] } });
  assert.match(text, /vision flickers|Whispers overlap|backwards/);
  // Under the Witch's Curse, a reading is sometimes an outright lie.
  let lies = 0;
  for (let seed = 0; seed < 60; seed++) {
    const t = curseResult('v', 'h', { h: { type: 'scry', targets: ['w'] }, w: { type: 'curse', targets: ['v'] } }, seed);
    if (/^(Hana interfered|Nothing unusual)/.test(t)) lies++;
  }
  assert.ok(lies > 20, `lies ${lies}`);
});

test('every role sees a plain Curse, and there is no Bind', () => {
  const { game } = newGame(6);
  game.start();
  game.hostCommand('skip');
  for (const p of game.players) {
    const spells = game.playerView(p.id).spells;
    assert.ok(!spells.some((s) => s.key === 'bind'));
    assert.deepEqual(spells.find((s) => s.key === 'curse'), { key: 'curse', label: 'Curse', targets: 1, desc: 'Curse another player.' });
  }
  const someone = game.players[0];
  assert.equal(game.act(someone.id, { type: 'cast', spell: 'bind', targets: [game.players[1].id, game.players[2].id] }).ok, false);
});

// --- outcome ---

function withFates(fates) {
  return PLAYERS.map((p) => ({ ...p, condemnedIn: fates[p.id] ?? null }));
}

test('village wins when the Witch is condemned at either trial', () => {
  assert.equal(evaluate(withFates({ w: 2 })).village, true);
  assert.equal(evaluate(withFates({ w: 1, v: 2 })).village, true);
  const o = evaluate(withFates({ v: 1, f: 2 }));
  assert.equal(o.village, false);
  assert.equal(o.witch, true);
  assert.equal(o.players.find((p) => p.id === 'f').won, true);
});

test('the Werewolf wins alongside either side when the Hunter falls', () => {
  const withWitch = evaluate(withFates({ h: 1, v: 2 }));
  assert.equal(withWitch.witch, true);
  assert.equal(withWitch.werewolf, true);
  const withVillage = evaluate(withFates({ h: 1, w: 2 }));
  assert.equal(withVillage.village, true);
  assert.equal(withVillage.werewolf, true);
  assert.equal(evaluate(withFates({ h: 1, l: 2 })).werewolf, false, 'condemned wolf loses');
  assert.equal(evaluate(withFates({ v: 1 })).werewolf, false, 'hunter survived');
  assert.equal(evaluate(withFates({ l: 1, h: 2 })).werewolf, false, 'wolf became the Ghost, so did not survive');
  assert.equal(evaluate(withFates({ h: 2 })).werewolf, true, 'hunter condemned at the Second Trial');
  assert.equal(evaluate(withFates({ h: 3 })).werewolf, true, 'hunter condemned at the Final Trial');
  assert.equal(evaluate(withFates({ l: 2, h: 3 })).werewolf, false, 'wolf condemned at the Second Trial');
});

// --- game flow ---

function newGame(n = 6, seed = 7) {
  let clock = 0;
  const game = new Game({ rng: seeded(seed), now: () => clock });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(game.join(`Player${i}`).id);
  const advance = (ms) => {
    clock += ms;
    game.tick();
  };
  return { game, ids, advance };
}

const byRole = (game, role) => game.players.find((p) => p.role === role);

test('lobby enforces minimum players and dedupes names', () => {
  const game = new Game();
  game.join('Sam');
  const second = game.join('sam');
  assert.equal(game.player(second.id).name, 'sam 2');
  assert.equal(game.start().ok, false);
});

test('rejoining with a token returns the same player', () => {
  const { game, ids } = newGame();
  game.start();
  const token = game.player(ids[0]).token;
  assert.equal(game.join('whatever', token).id, ids[0]);
  assert.equal(game.join('Late').ok, false);
});

test('a full game runs from roles to reveal', () => {
  const { game, advance } = newGame(7);
  assert.ok(game.start().ok);
  assert.equal(game.phase.type, 'roles');
  for (const p of game.players) game.act(p.id, { type: 'ready' });
  assert.equal(game.phase.type, 'cast', 'all ready auto-advances');

  // Round 1: everyone scries the next player.
  const living = () => game.living();
  const castAll = () => {
    const alive = living();
    alive.forEach((p, i) => {
      const target = alive[(i + 1) % alive.length];
      assert.ok(game.act(p.id, { type: 'cast', spell: 'scry', targets: [target.id] }).ok);
    });
  };
  castAll();
  assert.equal(game.phase.type, 'discuss');
  for (const p of game.players) assert.equal(game.playerView(p.id).inbox.length, 1);

  advance(90_000);
  assert.equal(game.phase.type, 'vote');
  const villager = byRole(game, 'villager');
  for (const p of living()) {
    const target = p.id === villager.id ? byRole(game, 'hunter').id : villager.id;
    game.act(p.id, { type: 'vote', target });
  }
  assert.equal(game.phase.type, 'verdict');
  assert.equal(villager.alive, false);
  assert.deepEqual(game.ghosts().map((g) => g.id), [villager.id]);
  assert.equal(game.publicView().trials[0].condemnedRole, null, 'first trial hides role');

  advance(12_000);
  assert.equal(game.phase.type, 'cast');
  assert.equal(game.act(villager.id, { type: 'cast', spell: 'scry', targets: [byRole(game, 'witch').id] }).ok, false);
  const medium = byRole(game, 'medium');
  assert.ok(game.playerView(medium.id).spells.some((s) => s.key === 'vision'));
  castAll();
  advance(150_000);
  assert.equal(game.phase.type, 'seance');

  // Séance 1: one Ghost.
  assert.equal(game.act(villager.id, { type: 'ghostMessage', text: 'one two three four five six seven eight nine' }).ok, false);
  assert.ok(game.act(villager.id, { type: 'ghostMessage', text: 'Two monsters argued, but only one lied.' }).ok);
  assert.equal(game.act(villager.id, { type: 'ghostAnswer', answer: 'Yes' }).ok, false, 'no answer before the question');
  assert.ok(game.act(medium.id, { type: 'mediumQuestion' }).ok);
  assert.equal(game.playerView(villager.id).seance.questionAsked, true);
  assert.ok(game.act(villager.id, { type: 'ghostAnswer', answer: 'Unclear' }).ok);
  assert.equal(game.act(villager.id, { type: 'ghostAnswer', answer: 'Yes' }).ok, false, 'only one answer');
  assert.deepEqual(game.playerView(medium.id).seance.answers, [{ from: villager.name, answer: 'Unclear' }]);
  assert.equal(game.playerView(byRole(game, 'hunter').id).seance.answers, null, 'answers are private to the Medium');
  assert.equal(game.playerView(byRole(game, 'witch').id).seance.myAnswer, null);
  assert.equal(JSON.stringify(game.publicView()).includes('Unclear'), false, 'laptop never shows the answer');

  // Ghosts see every other player's clues; the living do not.
  const ghostView = game.playerView(villager.id);
  const othersClues = game.players.filter((q) => q.id !== villager.id).reduce((n, q) => n + (game.inbox[q.id]?.length ?? 0), 0);
  assert.equal(ghostView.allClues.length, othersClues);
  assert.ok(ghostView.allClues.every((c) => c.player && c.text));
  assert.equal(game.playerView(medium.id).allClues, undefined);
  assert.equal(game.publicView().ghostMessages[0].text, 'Two monsters argued, but only one lied.');

  // Second Trial follows Séance 1; the condemned player becomes a second Ghost, role hidden.
  advance(180_000);
  assert.equal(game.phase.type, 'vote');
  assert.equal(game.phase.trial, 2);
  assert.equal(game.act(villager.id, { type: 'vote', target: medium.id }).ok, false, 'Ghosts cannot vote');
  const villager2 = game.players.find((p) => p.role === 'villager' && p.alive);
  for (const p of living()) {
    const target = p.id === villager2.id ? byRole(game, 'hunter').id : villager2.id;
    game.act(p.id, { type: 'vote', target });
  }
  assert.equal(game.phase.type, 'verdict');
  assert.equal(villager2.alive, false);
  assert.deepEqual(game.ghosts().map((g) => g.id), [villager.id, villager2.id]);
  assert.equal(game.publicView().trials[1].condemnedRole, null, 'second trial hides role');
  assert.ok(game.playerView(villager2.id).you.isGhost);
  assert.ok(game.playerView(villager2.id).allClues.length > 0, 'the new Ghost sees everyone\'s clues');

  advance(12_000);
  assert.equal(game.phase.type, 'cast');
  assert.equal(game.phase.round, 3);
  castAll();
  advance(150_000);
  assert.equal(game.phase.type, 'seance');
  assert.equal(game.phase.seance, 2);

  // Séance 2: both Ghosts message and answer; the Medium sees each answer labeled.
  assert.ok(game.act(villager.id, { type: 'ghostMessage', text: 'Trust the quiet one.' }).ok);
  assert.ok(game.act(villager2.id, { type: 'ghostMessage', text: 'Never trust the quiet one.' }).ok);
  assert.equal(game.publicView().seance.messagesSent, 2);
  assert.ok(game.act(medium.id, { type: 'mediumQuestion' }).ok);
  assert.ok(game.act(villager.id, { type: 'ghostAnswer', answer: 'Yes' }).ok);
  assert.deepEqual(game.playerView(medium.id).seance.answers, [
    { from: villager.name, answer: 'Yes' },
    { from: villager2.name, answer: null },
  ]);
  assert.ok(game.act(villager2.id, { type: 'ghostAnswer', answer: 'No' }).ok);
  assert.equal(game.playerView(medium.id).seance.answers[1].answer, 'No');
  assert.equal(game.playerView(villager.id).seance.myAnswer, 'Yes', 'a Ghost sees only their own answer');
  assert.equal(game.playerView(villager.id).seance.answers, null);

  advance(180_000);
  assert.equal(game.phase.type, 'nominate', 'the Final Trial follows the second Séance');

  const witch = byRole(game, 'witch');
  const hunter = byRole(game, 'hunter');
  for (const p of living()) game.act(p.id, { type: 'nominate', target: p.id === witch.id ? hunter.id : witch.id });
  assert.equal(game.phase.type, 'defense');
  assert.equal(game.nominees.length, 2);
  advance(20_000);
  assert.equal(game.phase.index, 1);
  advance(20_000);
  assert.equal(game.phase.type, 'vote');
  assert.equal(game.phase.trial, 3);
  for (const p of living()) game.act(p.id, { type: 'vote', target: p.id === witch.id ? hunter.id : witch.id });
  assert.equal(game.phase.type, 'verdict');
  assert.equal(game.publicView().trials[2].condemnedRole, 'Witch');
  assert.equal(game.ghosts().length, 2, 'the Final Trial does not create a Ghost');

  advance(12_000);
  assert.equal(game.phase.type, 'reveal');
  const view = game.publicView();
  assert.equal(view.outcome.village, true);
  assert.equal(game.playerView(witch.id).you.won, false);
  assert.equal(game.playerView(hunter.id).you.won, true);
  assert.equal(game.phaseIndex, SCHEDULE.length - 1);
});

test('a tied First Trial goes to a runoff, then a random pick', () => {
  const { game, ids, advance } = newGame(6);
  game.start();
  game.hostCommand('skip'); // roles
  game.hostCommand('skip'); // cast
  game.hostCommand('skip'); // discuss
  assert.equal(game.phase.type, 'vote');
  advance(60_000); // no votes at all → everyone tied
  assert.equal(game.phase.type, 'vote');
  assert.equal(game.trials[1].runoff, true);
  advance(60_000);
  assert.equal(game.phase.type, 'verdict');
  assert.ok(game.trials[1].randomTieBreak);
  assert.equal(game.living().length, ids.length - 1);
});

test('a tied Second Trial also ends in a random pick, creating a second Ghost', () => {
  const { game } = newGame(6);
  game.start();
  while (!(game.phase.type === 'vote' && game.phase.trial === 2)) game.hostCommand('skip');
  game.hostCommand('skip'); // → runoff
  assert.equal(game.trials[2].runoff, true);
  game.hostCommand('skip');
  assert.equal(game.phase.type, 'verdict');
  assert.ok(game.trials[2].randomTieBreak);
  assert.equal(game.ghosts().length, 2);
});

test('a deadlocked Final Trial condemns nobody', () => {
  const { game } = newGame(6);
  game.start();
  while (!(game.phase.type === 'vote' && game.phase.trial === 3)) game.hostCommand('skip');
  game.hostCommand('skip'); // → runoff
  assert.equal(game.phase.type, 'vote');
  game.hostCommand('skip');
  assert.equal(game.phase.type, 'verdict');
  assert.equal(game.publicView().trials[2].noVerdict, true);
  game.hostCommand('skip');
  assert.equal(game.phase.type, 'reveal');
  assert.equal(game.outcome.witch, byRole(game, 'witch').condemnedIn == null);
});

test('pause freezes the timer and addTime extends it', () => {
  const { game, advance } = newGame(5);
  game.start();
  game.hostCommand('pause');
  advance(120_000);
  assert.equal(game.phase.type, 'roles');
  game.hostCommand('resume');
  game.hostCommand('addTime');
  advance(80_000);
  assert.equal(game.phase.type, 'roles');
  advance(10_000);
  assert.equal(game.phase.type, 'cast');
});

test('player views never leak other roles before the reveal', () => {
  const { game } = newGame(6);
  game.start();
  const view = JSON.stringify(game.playerView(byRole(game, 'villager').id));
  for (const role of ['witch', 'familiar', 'werewolf', 'hunter', 'medium']) {
    assert.doesNotMatch(view, new RegExp(`"role":"${role}"`));
  }
  assert.doesNotMatch(JSON.stringify(game.publicView()), /"role":/);
  const familiarView = game.playerView(byRole(game, 'familiar').id);
  assert.equal(familiarView.you.witchName, byRole(game, 'witch').name);
});

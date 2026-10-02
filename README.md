# 🕯️ Witch Trial

A ~25-minute social-deduction party game for 5–12 players. Everyone plays on their own phone, and one person runs the shared **table screen** (timer, Ghost messages, verdicts, reveal), either on a laptop or TV in the room or screenshared on a video call.

## Running a game

1. The host opens **`/host`** on the deployed site (or **http://localhost:3000/host** when running locally). This creates a new village with a four-letter code, such as `KXRP`.
2. Put that screen where everyone can see it, or share it on the video call.
3. Players open the join link shown on the screen: scan the QR code in person, or paste the link into the call's chat. They can also go to `/play` and type the village code.
4. The host joins on their own phone too, because the table screen is public.
5. Press **Begin the game** once 5 or more players have joined.

First-time players can read the rules at **/rules**. The phone join screen and lobby link to it.

The table screen has **Pause**, **+30s**, and **Skip** controls. Only the browser tab that created the village can use them, so players can't skip phases from their phones. Refreshing that tab keeps the same village, but opening `/host` in a new tab starts a new one.

If a phone refreshes or loses its connection, reopening the page in the same browser tab rejoins that player automatically. A village is deleted 10 minutes after everyone (table screen and phones) has disconnected.

Several groups can play at once; each table screen runs its own village.

## Running locally

```bash
npm install
npm start
```

Open http://localhost:3000/host. Phones on the same Wi-Fi can join using the link the table screen shows (e.g. `http://192.168.x.x:3000/play/?room=KXRP`).

## Deploying to Render

1. Push this repository to GitHub.
2. In Render, create a **Web Service** from the repository with:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
3. Once it's live, open `https://<your-service>.onrender.com/host`.

The server reads Render's `PORT` and `RENDER_EXTERNAL_URL` automatically, so join links and QR codes use the public address. To use a custom domain, set `PUBLIC_URL` (e.g. `https://witchtrial.example.com`).

Things to know about the free tier:
- The server sleeps after about 15 minutes without visitors, so the first visit afterwards can take up to a minute. Open the table screen a minute before you start.
- Games live only in the server's memory. A redeploy or restart ends every game in progress, so don't push changes while people are playing.

## Game flow

| Phase | Default time |
|---|---|
| Secret Roles | 60s (advances early when everyone is ready) |
| Spell Round 1 → discussion | 60s cast, 90s talk |
| First Witch Trial → verdict | 60s vote. The condemned player becomes a **Ghost**; their role stays hidden. |
| Spell Round 2 → discussion | 60s cast, 150s talk |
| Séance | 180s. One Ghost. |
| Second Witch Trial → verdict | 60s vote. The condemned player becomes a **second Ghost**; their role stays hidden. |
| Spell Round 3 → discussion | 60s cast, 150s talk. The last chance to cast. |
| Second Séance | 180s. Both Ghosts. |
| Final Trial | 45s nominations, 20s defense per accused (top 3), then a simultaneous vote. The condemned player's role is revealed. |
| Reveal | Every phone shows its player's role and whether they won. |

Timed phases also advance as soon as everyone has acted. Durations live in `DEFAULT_DURATIONS` in [server/engine/game.js](server/engine/game.js).

### House rules chosen where the original rules were open
- Each living player gets **one action per round**. True Scry and Vision use up that round's action.
- The Witch Hunter's **True Scry** can be used once, in any round. The Medium's **Vision** can be used once, in Round 2 or 3.
- **Ghosts** cannot cast spells, vote, or nominate. Each Ghost sends one message of 8 words or fewer per Séance, so the second Séance can have two messages. From the moment they're condemned, their phone shows **every clue the other players have received**.
- **Séance question:** the Medium asks one yes-or-no question **out loud**, then taps "I have asked my question". Each Ghost answers Yes / No / Unclear on their phone, and **only the Medium's phone** shows the answers, labeled by Ghost.
- **Werewolf victory:** the Werewolf wins only if they are **never condemned** (becoming a Ghost counts as condemned) **and** the Witch Hunter is condemned at any of the three trials. They can win alongside either side.
- Every game has at least one Witch, Familiar, Werewolf, Witch Hunter, and **Medium**; any remaining players are Villagers. With exactly 5 players there are no Villagers.
- **Ties:**
  - A tied First or Second Trial goes to one runoff; if it's still tied, one of the tied players is picked at random.
  - A tied Final Trial goes to one runoff; if it's still tied, **nobody is condemned** (and the Witch survives).
- **Spells:** each round, a living player chooses **Scry** or **Curse** (plus True Scry or Vision if their role has it). There is no Bind.
- **Curses:**
  - On every phone the spell is just "Curse — Curse another player." Players aren't told that it gives them anything back.
  - An ordinary Curse garbles the target's information this round but keeps it technically true.
  - The Witch's Curse can make it an outright lie.
  - True Scry is immune to all Curses.
  - After the round, the caster quietly receives a reading that depends on their role:

    | Role | The caster learns |
    |---|---|
    | Witch | Whether her Curse actually corrupted something the target learned |
    | Familiar | Who or what the target's own magic was about (e.g. "concerned Wendy", "concerned the Witch"), not what they learned |
    | Werewolf | Whether the target used investigative magic (Scry, True Scry, Vision), disruptive magic (Curse), or neither |
    | Witch Hunter | Whether anyone else's Curse landed on the target |
    | Medium | Whether a supernatural player (Witch, Familiar, Werewolf, Medium) cast a spell at the target, or the target is supernatural and cast one |
    | Villager | Whether the target sought information, interfered with magic, or did nothing unusual |

  - Readings are information too, so a caster who is cursed that round gets a garbled reading, or a false one under the Witch's Curse. A caster's own Curse never appears in their own reading.
- The **Werewolf** is never shown as Witch-aligned, even by a forged clue.

## Development

```bash
npm test            # engine tests (roles, clue truthfulness, curses and their readings, ties, win conditions, full game)
npm run dev         # server with every timer shortened to 1/6
npm run bots -- KXRP 5   # fill village KXRP with 5 bots that play randomly (join from your own browser too)
```

The village code is shown on the table screen. To send bots to a deployed server, add its URL: `npm run bots -- KXRP 5 https://<your-service>.onrender.com`.

Each browser **tab** counts as a separate player, so you can also test by opening several tabs of `/play`.

### Layout
- `server/engine/`: the game logic, with no networking code.
  - `game.js`: the phase state machine and the per-player and public views.
  - `roles.js`: roles and their traits.
  - `clues.js`: Scry clue templates, both truthful and forged.
  - `spells.js`: resolves each round (Curse → Scry / True Scry / Vision → Curse readings).
  - `readings.js`: what each role learns from casting a Curse.
  - `vision.js`: the Medium's hints.
  - `outcome.js`: win conditions.
- `server/index.js`: Express and Socket.IO, plus the villages (rooms), host keys, and idle cleanup. Each phone receives only its own view, so roles never leak before the reveal.
- `public/host/`: the table screen.
- `public/play/`: the phone client.
- `public/rules/`: the player-facing How to Play page.
- `public/shared/`: the theme and shared helpers.
- `scripts/bots.js`: random bots for testing.

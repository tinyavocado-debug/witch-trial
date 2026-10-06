# Design standards: Witch Trial landing page

The rules for how this site looks. `tokens.css` implements them; when the two disagree, fix one of them on purpose. This covers the landing page only; the game's own screens (`public/`) have their own theme.

## Why this site exists
People land here because they've just heard about Witch Trial, maybe from a friend, a group chat or a shared link, and they want to know whether it's worth playing. The site's job is to introduce the game and, more importantly, to make them want to play it: to get them to host a game or bring it to their group.

We do that by making the visit feel like the game. The visitor walks through the village at night, past the bonfire and into the courthouse, and feels the suspicion and the trial before they read a single rule. Every design choice should serve that walk.

What this means in practice:
- **Feeling first, mechanics second.** Lead each stop with atmosphere and the drama of a moment from the game (a whispered clue, an accusation, a Ghost's message). Leave the detailed rules to the How to Play page and link to it.
- **Answer the deciding questions along the way.** Someone choosing whether to play needs to learn quickly: 5–12 players, about 25 minutes, everyone on their own phone plus one shared screen, in person or on a video call, nothing to install. Work these into the walk; don't hide them at the bottom.
- **Keep the way in close.** The Host button should never be far away, so the moment a visitor is convinced they can start a game.
- **Immersion must never block understanding.** If an effect makes the text harder to read or the page slower to start, the effect loses.
- **End on the visitor.** The walk finishes by turning the accusation on them, so the last thing they feel is what it's like to be in the game.

## Feel
A dark village at night, lit by two kinds of light:
- **Purple is the supernatural**: moonlight, magic, spells, clues, Ghosts, anything you can't quite trust. It's the ultraviolet glow and foil line art of a grimoire cover.
- **Orange is the human world**: firelight, torches, the trial, condemnation, and the buttons that start a game.
- **Dark greys and black** are everything else, and that's most of the screen.

## Palette
Sampled from the reference images: the grimoire cover (purples), the red-orange book (oranges), and the Dracula editor theme (greys).

| Token | Hex | OKLCH | Role |
|---|---|---|---|
| **Darks** | | | |
| `--black` | `#0b0a0f` | `oklch(14.9% 0.011 294)` | Deepest shadow, scrims, the blackout |
| `--gray-950` | `#121118` | `oklch(18.2% 0.014 291)` | Page background |
| `--gray-900` | `#21222c` | `oklch(25.5% 0.019 280)` | Panels, cards, placeholders |
| `--gray-800` | `#282a36` | `oklch(28.8% 0.022 278)` | Raised panels |
| `--gray-700` | `#3b3d4d` | `oklch(36.5% 0.028 279)` | Borders and rules (never text) |
| `--gray-400` | `#a7a3b8` | `oklch(72.6% 0.030 294)` | Secondary text |
| `--cream` | `#efe4dc` | `oklch(92.5% 0.016 59)` | Primary text; the accusation document |
| **Purples** | | | |
| `--purple-950` | `#24044a` | `oklch(22.7% 0.115 296)` | Deep violet shadows and night sky |
| `--purple-700` | `#4403bb` | `oklch(39.6% 0.232 283)` | Ultraviolet glow (backgrounds only); ink on cream |
| `--purple-500` | `#893ae5` | `oklch(54.9% 0.239 299)` | Bright violet glow, large display accents |
| `--purple-300` | `#be93f9` | `oklch(74.3% 0.149 302)` | **Lilac.** Clues, claims, links, focus ring |
| `--purple-200` | `#d298fb` | `oklch(77.1% 0.149 310)` | **Foil.** Thin line art and ornaments, highlights |
| **Oranges** | | | |
| `--orange-950` | `#490603` | `oklch(26.1% 0.098 30)` | Oxblood shadows (Courthouse, Chapel) |
| `--orange-800` | `#961503` | `oklch(43.2% 0.165 31)` | Deep fire glow |
| `--orange-600` | `#d62d14` | `oklch(57.0% 0.207 31)` | **Ember.** Condemnation fills and large type |
| `--orange-500` | `#f26a4b` | `oklch(68.6% 0.174 34)` | Ember for text (condemnation copy) |
| `--orange-400` | `#e38411` | `oklch(70.1% 0.158 62)` | **Amber.** Firelight; primary button fill |

## How much of each
- **Darks: about 85%** of any screen. The page should feel mostly like darkness.
- **Purple: about 10%**, mostly as glows and thin lines, rarely as solid fills.
- **Orange: about 5%**, saved for buttons, firelight and condemnation. If orange is everywhere, the call to action stops standing out.
- Don't set purple and orange text side by side at full strength. When both appear in a scene, one leads and the other glows.

## Contrast (WCAG 2, on `--gray-950` unless noted)
Safe for body text (4.5:1 or better):
- cream 15.0
- lilac 7.8
- foil 8.6
- gray-400 7.7
- amber 6.8
- orange-500 6.2

Large text (24px+) or fills only:
- ember `--orange-600` 3.8
- violet `--purple-500` 3.4

Never text:
- ultraviolet 1.8
- gray-700 1.8

On the cream document:
- black 15.8
- ultraviolet 8.5 (its accent ink)
- ember 4.0 (large text only)

On amber buttons, use black text (7.1).

## Type
- **Display:** IM Fell English, roman only, no italic headings. Used for titles, location names, claims and dialogue. It matches the game's screens.
- **Body and UI:** Inter 400/500/600, for rules text, labels and buttons.
- **Caps** for institutional moments only: WITCH TRIAL, button labels, the accusation (THE VILLAGE HAS ACCUSED YOU, PROVE IT). Write them in sentence case in the HTML and uppercase them with CSS.
- The scale is in `tokens.css` (`--text-xs` … `--text-title`). Body is 16px (15px on small phones). Inside the glass cards over the video, everything is a step smaller so the cards cover less of the scene: body 14px, stop titles `--text-2xl` (1.5rem on phones).

## Line art
Follow the grimoire cover: thin single-weight lines (1–1.5px) in foil (`--purple-200`) for frames, dividers and small symbols such as stars, moons and sigils. No heavy borders and no thick coloured side stripes.

## Components
- **Primary button:** amber fill with black text. Uppercase Inter 600, letter-spaced, 4px radius, at least 48px tall. Hover lightens toward cream.
- **Secondary button:** transparent with a `--gray-700` border and cream text; hover brightens the border.
- **Quiet link button:** cream text, underlined, no border (HOW TO PLAY).
- **Clue / claim:** display font in lilac. The flicker and smear effect uses lilac shifting toward violet, never orange.
- **Condemnation** (trial results, "the Witch walks free"): `--orange-500` text, or `--orange-600` for large display.
- **Accusation document:** cream paper with black text and ultraviolet accents, plus a foil-style thin frame. It is the one light object on the page.
- **Glass card** (every stop's text over the video): frosted glass after codefronts.com's MIT-licensed "Glassmorphism Card Over Video Background", in cream instead of white. A cream gradient (`--color-glass-top` to `--color-glass-bottom`), `blur(--glass-blur) saturate(170%)` on the video behind it, a 1px `--color-glass-edge` rim with a matching inner top highlight, `--radius-glass` corners, and a deep `--color-glass-shadow` below. No overlay across the whole video. Where the browser can't blur, or the visitor prefers reduced transparency, it turns solid.
- **Text over art:** a tight `--black` shadow under the letters keeps text readable, on the glass cards and on the opening title; buttons don't get it.
- **Focus ring:** 2px lilac, offset 3px, shown instantly.

## Art direction for the panorama images
Night scenes, mostly in shadow. Moonlight and magic glow in purple (ultraviolet to lilac); windows, torches and the bonfire glow in amber to ember. Leave darker, quieter areas where the text cards sit (lower left on desktop, lower third on phones). One house in the opening village gets the barely perceptible unnatural light, which is purple.

## Motion
- Slow and quiet. Effects use opacity and transform only, with the easings in `tokens.css`.
- Flickers stay faint and occasional, and only run while on screen.
- Reduced motion: no camera movement (stops crossfade), no flicker, transitions of 150ms or less.

## Do / don't
- **Do** let darkness dominate. Use glows (radial gradients) behind content. The only effect on text is the dark legibility shadow for text over art.
- **Don't** use gradient text, pure `#000`/`#fff`, or more than one accent colour inside a single component. Glass is for the stop text cards only, not buttons or decoration.
- **Don't** put small text in ember, violet or ultraviolet on dark backgrounds.

## Decisions log
- **2026-10-05:** Palette set from three references: a purple grimoire cover, a red-orange book, and the Dracula editor greys. Purple means supernatural and orange means human, fire and trial.
- **2026-10-05:** Purpose recorded: the site exists to win over people who have just heard of the game, by making the visit feel immersive rather than explaining the rules.
- **2026-10-05:** Removed the dark scrims behind every stop's text (they slid over the video and made each transition obvious). Text over art now relies on a tight dark text shadow.
- **2026-10-05:** Stop text moved onto frosted glass cards, adapted from codefronts.com's glass card over video (MIT). This lifts the earlier ban on glassmorphism for these cards only.

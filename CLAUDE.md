# litm-roll-tracker

A Foundry VTT module that tracks rolls made in Legend in the Mist (the `litmv2`
system) and shows statistics for each hero: general dice data plus
Legend in the Mist-specific info such as outcomes, roll types, Power and tags.

This file is the project guide for contributors and AI coding assistants.

## Targets
- Foundry VTT v14
- The `litmv2` system (tested with 14.68; source: https://github.com/Son-of-Oak-Community/litmv2)

## Content rules
- Never include Legend in the Mist rules text, art, icons or fonts in this
  repo. Describe mechanics in your own words and cite core book page numbers.
- litmv2's art and icons are under a proprietary license: reference them at
  runtime by path (e.g. the outcome icons
  `systems/litmv2/assets/media/icons/{success,snc,consequences}.svg`) and
  provide our own fallback in case they fail to load. Fonts are referenced
  by name (litmv2 loads them), with fallbacks.

## Tracking rules
- Stats are tracked per **hero** (hero actor), not per user. The UI may show
  "played by <user>" to indicate who owns the hero.
- Acting Together (group roll on the Fellowship actor): add the roll to the
  stats of **each participating hero** (from the roll's `participantIds`).
- In the stats UI (e.g. History), Acting Together rolls appear under the
  Fellowship actor's name and image (`game.litmv2.fellowship`).
- Helping Each Other (another hero contributes a tag to a roll): the roll
  counts for the roller; the tag counts toward the hero who **owns** it.
- Record rolls in every roll mode: public, private GM, blind and self.
  There's no privacy filter: every player can see every hero's stats.
- Rolls are saved by the active GM only, in a hidden data journal (keyed by
  chat message id). Rolls made while no GM is online aren't recorded.
- The GM's computer stamps each roll with the live session when saving it.
- While tracking is paused (world setting), no rolls are recorded.
- Rolls not tied to a hero are not tracked.

## Working with litmv2
litmv2 is built to be extended by modules. Use only its public surface:
- `game.litmv2` (classes such as `LitmRoll`), `CONFIG.litmv2` (settings and
  constants), and the custom `litm.*` hooks. Don't rely on its private helpers.
- `litm.roll` fires after every roll with `(roll, message)`. `roll.outcome.label`
  is `success`, `snc` (success with consequences) or `consequences`;
  `roll.litm.type` is the move (quick, tracked, mitigate, sacrifice).
  "Tracked" rolls are labelled "Detailed" in litmv2's UI.
  `roll.litm.totalPower` is the action's Power going into the roll;
  `roll.power` is the Power left to spend afterward (null for quick and
  sacrifice rolls, which don't give Power). The tag lists give the details.
- Burned tags appear only in the roll's `scratchedTags` list, not in
  `powerTags`.
- The GM sometimes rolls for a hero (Narrator's Call), so the clicking user
  is not always the hero's player. Always attribute rolls to the hero.
- With roll approval on, the approved roll runs on the player's client, so
  `litm.roll` fires once there. Ignore the moderation (approval) card itself.
- Pushing a roll happens later, from the chat card, and edits the existing
  message: `litm.roll` doesn't fire again.
- litmv2 uses the socket namespace `system.litmv2`; ours is
  `module.litm-roll-tracker`.

## Code style
- Plain JavaScript ES modules, no build step. Entry point: `scripts/main.js`.
- Tabs for indentation (matches litmv2).
- Explanatory comments: say what each part does and why, especially for
  Foundry concepts (hooks, settings, flags, sockets).
- Use the `MODULE_ID` constant; prefix console output with `litm-roll-tracker |`.
- All user-visible text goes in `lang/en.json` and is read with
  `game.i18n.localize`.
- Use current Foundry v14 APIs: ApplicationV2 for windows, `DialogV2`,
  `renderTemplate`, Foundry's native tabs. No deprecated APIs.
- Use Foundry CSS utility classes and variables before custom styles. Our own
  CSS classes use the `lrt--` prefix; the look lives in the "Theme" section
  of `styles/roll-tracker.css` and follows Foundry's light/dark setting.
- Non-submit buttons inside forms need `type="button"`.
- The UI must handle large numbers and long text without breaking: thousands
  of rolls, counts like "1,284×", long tag and hero names, many heroes or
  sessions in a dropdown. Format numbers, truncate long text (full text in a
  tooltip), and let long lists scroll. Test screens with big values.
- Design is our own, but the UI should feel at home next to litmv2.

## Images
Follow Foundry's media guide (https://foundryvtt.com/article/media/):
- Use **WebP** for images whenever possible.
- Use **SVG** for icons and simple graphics. An SVG shown on the canvas needs
  an explicit `width` and `height` in its markup.
- PNG only for small images; avoid JPEG.

## Workflow
- One branch per feature (e.g. `feature/pause-button`), merged into `main`
  through a pull request. `main` must always work.
- Small commits with short, descriptive messages.

## Definition of done
A feature is done when:
1. It works in a test world.
2. The F12 console shows no errors or deprecation warnings from this module.
3. It's been checked as both GM and a player.
4. The change has been code-reviewed.

Automated tests (Vitest) come later, for the stats logic in `scripts/stats.js`.

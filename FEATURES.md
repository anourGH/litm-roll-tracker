# Feature list

Features of Legend in the Mist: Roll Tracker: what's built (ticked) and
what's planned. Items move from here into GitHub Issues when work starts.

## v1

### Tracking
- [x] Capture every litmv2 roll through the `litm.roll` hook
- [x] Record each roll for its hero (not the user who clicked)
- [x] Acting Together: add the roll to every participating hero
- [x] Count each roll exactly once (multiple connected users, GM approval)
- [x] Record all roll modes (public, private GM, blind, self)
- [x] Save each tag used in a roll (id, name, type, state) and the hero who
      owns it, so tag insights work
- [x] Save the live session on each roll

Recorded per roll: time (for ordering only, never shown), session, hero,
user who rolled, both dice, power, total, outcome, roll type, tags used
(power / weakness / burned / relationship / story / status), roll mode,
Acting Together participants.

### Session Controls (GM)
- [x] GM-only "Session Controls" button in the scene controls (left toolbar)
- [x] Start a session: name dialog, empty field showing "Session N" as faded
      placeholder text (left empty = the default name)
- [x] End a session, with a confirmation naming the session and its roll count
- [x] Shows the live session and its roll count, or "Current rolls are between
      sessions" and the last session's name
- [x] Rolls outside a session are recorded as "Between sessions" and count
      toward all-time stats only
- [x] Sessions have no dates or times; none are shown anywhere in the UI

### Roll Tracker window
- [x] Opened from a button in the scene controls (left toolbar), for everyone
- [x] About 1020×500, with four tabs: Summary, Tags, Dice, History
- [x] Header: hero portrait, hero dropdown (every hero plus "All heroes"),
      "played by <user>", and a range dropdown
- [x] Clicking the portrait opens that actor's sheet (the Fellowship's for
      "All heroes"), if the user is allowed to see it
- [x] Range dropdown lists "All time" and each session, newest first; the
      live one is marked "(live)"
- [x] Default range: the live session if there is one, otherwise All time
- [x] Default hero: the user's assigned character, otherwise All heroes.
      The range stays the same when switching heroes.
- [x] Headline above the tabs: success rate and roll count
      (e.g. "77% successes · 37 of 48 rolls")
- [x] "No data" screen when the selection has no rolls (dropdowns still work)
- [x] "Tracking paused" banner when tracking is paused
- [x] All players can view every hero's stats
- [x] Data refreshes when the window is reopened (no live updates)

#### Summary tab
- [x] Tiles: rolls, average power, average dice total, success streak
      (current and longest; success or success with consequences)
- [x] Outcome split: bar plus count and percentage for each outcome, in
      colors taken from litmv2's outcome icons (gold, deep purple, and their
      mix for success with consequences)
- [x] Favorite power, weakness and relationship tags. On "All heroes", the
      owner's portrait and name sit in each card's label line; relationship
      tags also show who they're with.

#### Tags tab
- [x] Top power tags, top weakness tags, top relationship tags (top 3 each)
- [x] Lucky tags: best success rate (success or success with consequences),
      for tags used at least 3 times
- [x] Most burned tags, plus the total number of burns
- [x] On "All heroes", each tag shows its owner's portrait (name on hover);
      relationship tags show who they're with the same way

Tag counting rules:
- Power tags include fellowship tags, except when a single hero is selected
  (also for the Summary favorite)
- A burned tag counts as a use
- Relationship tags count whether they helped or hindered
- A tag contributed by another hero (Helping Each Other) counts toward the
  hero who owns the tag
- Deleted tags are left out; renamed tags show their current name
- Ties go to the most recently used tag
- Empty places in a top-3 list show "No data"

#### Dice tab
- [x] Histogram of 2d6 totals (2–12), following the hero selection
- [x] Average (last 10 rolls) in the selected range: "Hot streak" badge at 8.0
      or higher, "Cold streak" badge at 6.0 or lower. Under 10 rolls, show
      progress (e.g. 7/10).
- [x] Double 1s and double 6s

#### History tab
- [x] One flat list, newest first, in the selected range
- [x] Each row: hero portrait and name, roll type, power, outcome (litmv2's
      outcome icon plus a label, with our own fallback icon), and a mark for
      pushed rolls
- [x] Session column
- [x] Rolls with a contributed tag show "+" and the helper's portrait next to
      the hero's name; the roll still counts only for the roller
- [x] Click a row to expand it: both dice, tags grouped by type, statuses.
      Burned and hindering tags are marked; contributed tags show the
      helper's portrait.
- [x] Acting Together rolls appear for every participant and show the
      Fellowship's name and image
- [x] "Show more" button loads 25 more rows at a time, keeping the scroll
      position
- Story tags the GM hid from players are shown like any other tag

### Manage roll data (GM, module settings)
- [x] "Developer mode" world setting (off by default) for testing tools
- [x] Fake data: pick heroes and a number of rolls per hero (up to 500) to
      generate sample rolls from the heroes' real tags. Fake rolls are marked
      and can be wiped separately, with confirmation.
- [x] GM-only "Manage roll data" menu with three tabs: Reset data, Fake data
      (Developer mode only) and Tracking
- [x] Reset data: pick heroes (with roll counts) or select all; "Select all"
      also clears rolls of deleted heroes. Error if nothing is picked;
      confirmation shows the total being deleted. Shared rolls only lose the
      reset hero; sessions are kept.
- [x] Tracking: pause or resume recording, world-wide

### Look
- [x] Styling that feels at home next to litmv2: its fonts (blackletter for
      big headers, Grenze, Labrada) and its tag and status highlights
- [x] Light and dark mode, following Foundry's colour scheme setting

## After v1
- Track pushes made from the chat card after the roll (Quick: Great
  Success; Detailed: +1 Power), via Foundry's `updateChatMessage` hook
- Save Trade Power on Detailed rolls (throw caution to the wind / hedge your
  risks; core book p.158)

## Later
- Compare: two or more heroes side by side
- Filters inside the History tab (outcome, roll type, ...)
- More tag insights: unlucky tags, top statuses, top story tags, tags per
  roll, best tag pairs
- Charts and trends over time
- Session recap card posted to chat
- Floating "latest roll" display
- Export to CSV / JSON
- Wait for Dice So Nice animations before updating
- Archive or split stored rolls once a world has thousands of them
- Automated tests (Vitest) for the stats logic

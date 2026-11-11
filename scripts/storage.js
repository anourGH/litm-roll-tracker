// Storage: saves roll records in a hidden journal entry, the "data journal".
//
// Why a journal? Journal entries are Foundry "documents": saved in the world,
// synced to every connected computer, and with "ownership" that controls who
// can see or edit them. Ours is readable by everyone but only the GM writes.
// The rolls live in the journal's "flags", a place on any document where a
// module can keep its own data, labelled with the module's id.
//
// Only the GM can write, so a player's roll is sent to the GM's computer by
// "socket" (a message between connected computers that isn't saved anywhere),
// and the GM's computer saves it.

const SOCKET_EVENT_SAVE = "saveRoll";

let moduleId;

/**
 * First half of setup, called from main.js during "init".
 * The Journal sidebar can be drawn before "ready", so the hiding hook and
 * the module id need to be in place this early.
 * @param {string} id  Our module id.
 */
export function registerStorage(id) {
	moduleId = id;

	// "renderJournalDirectory" fires every time Foundry draws the Journal sidebar.
	Hooks.on("renderJournalDirectory", hideDataJournal);
}

/**
 * Second half of setup, called from main.js during "ready", when game data
 * (users, journals) is available.
 */
export async function initStorage() {
	// The active GM makes sure the data journal exists. If several GMs are
	// online, Foundry picks one as the "active GM", so only one creates it.
	// This happens BEFORE we start listening for players' rolls: otherwise a
	// roll arriving while the journal is still being created could start
	// creating a second one.
	if (isActiveGM()) await getOrCreateDataJournal();

	// Listen for rolls sent by players. Our socket channel is
	// "module.<module id>"; module.json's "socket": true makes it exist.
	game.socket.on(`module.${moduleId}`, onSocketMessage);
}

/**
 * Record a roll: save it directly, send it to the GM, or skip it if no GM is
 * online. Called on the roller's computer for every captured roll.
 * @param {object} record  The roll record from roll-capture.js.
 */
export async function recordRoll(record) {
	// Names can change, so we don't store them; the window looks up current
	// names when it shows the data.
	const { heroNames, ...stored } = record;

	// While the GM has paused tracking, rolls aren't recorded at all.
	if (isTrackingPaused()) return;

	if (isActiveGM()) {
		await saveRoll(stored);
	} else if (game.users.activeGM) {
		// A GM is online: hand the roll to the GM's computer.
		game.socket.emit(`module.${moduleId}`, { event: SOCKET_EVENT_SAVE, record: stored });
	} else if (game.settings.get(moduleId, "noGmBehavior") === "warn") {
		// No GM online: the roll can't be saved. Tell the player if the GM chose that.
		ui.notifications.warn(game.i18n.localize("LRT.Warnings.notRecordedNoGm"));
	}
}

/**
 * Read every saved roll. Anyone can call this: all users can read the journal.
 * Each record gets an `id`: the key it's saved under (usually its chat
 * message id), so the window can tell rolls apart, e.g. which are expanded.
 * @returns {object[]}  The roll records, in no particular order.
 */
export function getRolls() {
	const rolls = getDataJournal()?.getFlag(moduleId, "rolls") ?? {};
	return Object.entries(rolls).map(([id, roll]) => ({ ...roll, id }));
}

/**
 * Find the data journal, which we mark with a flag so we can always find it
 * again even if someone renames it.
 * @returns {JournalEntry|undefined}
 */
export function getDataJournal() {
	return game.journal.find((journal) => journal.getFlag(moduleId, "dataJournal"));
}

/**
 * Hide the data journal from the Journal sidebar, unless the GM has turned on
 * "Show data journal". Called whenever Foundry draws the Journal sidebar.
 * This only tidies the sidebar: anyone can still read the data.
 * @param {Application} _app   The Journal sidebar (not needed here).
 * @param {HTMLElement} html   The sidebar's HTML, which we can change.
 */
function hideDataJournal(_app, html) {
	if (game.settings.get(moduleId, "showDataJournal")) return;

	const journal = getDataJournal();
	if (!journal) return;

	// Each sidebar entry carries its document id in "data-entry-id".
	html.querySelector(`[data-entry-id="${journal.id}"]`)?.remove();
}

/** True while the GM has paused tracking. */
export function isTrackingPaused() {
	return game.settings.get(moduleId, "trackingPaused");
}

/** Pause or resume tracking for the whole world (GM only). */
export async function setTrackingPaused(paused) {
	await game.settings.set(moduleId, "trackingPaused", paused);
}

/**
 * Work out what a reset would change, without changing anything yet. The
 * window uses this both to show the confirmation and to do the reset, so the
 * number the GM confirms is exactly what happens.
 *
 * Each roll loses the heroes being reset. A shared (Acting Together) roll
 * keeps its other heroes; a roll with no heroes left is deleted.
 * @param {Set<string>} heroIds    Heroes to reset.
 * @param {boolean} deletedHeroes  Also reset heroes that no longer exist.
 * @returns {{ deletions: string[], updates: Map<string, string[]> }}
 *   Roll ids to delete, and roll ids → their remaining heroes.
 */
export function planReset(heroIds, deletedHeroes) {
	const deletions = [];
	const updates = new Map();
	const removed = (id) => heroIds.has(id) || (deletedHeroes && !game.actors.get(id));

	for (const roll of getRolls()) {
		const before = roll.heroIds ?? [];
		const after = before.filter((id) => !removed(id));
		// A roll with no heroes at all also counts as a deleted hero's roll.
		if (after.length === 0 && (before.length > 0 || deletedHeroes)) deletions.push(roll.id);
		else if (after.length < before.length) updates.set(roll.id, after);
	}
	return { deletions, updates };
}

/**
 * Carry out a reset worked out by planReset (GM only), in one update.
 * Sessions are left alone.
 */
export async function applyReset({ deletions, updates }) {
	const journal = getDataJournal();
	if (!journal || (deletions.length === 0 && updates.size === 0)) return;

	const { ForcedDeletion } = foundry.data.operators;
	const rolls = {};
	for (const id of deletions) rolls[id] = new ForcedDeletion();
	for (const [id, heroIds] of updates) rolls[id] = { heroIds };
	await journal.update({ flags: { [moduleId]: { rolls } } });
}

/** True if this computer belongs to the GM who saves rolls. */
function isActiveGM() {
	return game.user === game.users.activeGM;
}

/** Handle a socket message. Every other connected computer receives it. */
async function onSocketMessage(message) {
	if (message?.event !== SOCKET_EVENT_SAVE) return;

	// Only the active GM saves, so a roll is never written twice.
	if (!isActiveGM()) return;

	await saveRoll(message.record);
}

/**
 * Save one roll into the data journal (active GM only).
 * Each roll is stored under its chat message id, so if the same roll ever
 * arrives twice it simply overwrites itself instead of counting twice.
 */
async function saveRoll(record) {
	// Checked again here, on the GM's computer: a roll could be sent just
	// before the GM pressed Pause.
	if (isTrackingPaused()) return;

	const journal = await getOrCreateDataJournal();
	if (!journal) return;

	const key = record.messageId ?? foundry.utils.randomID();

	// Stamp the session that's live right now. This happens here, on the GM's
	// computer, rather than when the roll is made: the GM's computer is the
	// one saving, so its answer is the one every roll should share.
	// null means "between sessions".
	const stamped = { ...record, sessionId: journal.getFlag(moduleId, "liveSession") ?? null };

	// Updating one nested key sends only this roll to everyone, not the whole
	// history: "flags.<module>.rolls.<key>" means "this one entry".
	await journal.update({ [`flags.${moduleId}.rolls.${key}`]: stamped });
}

/*
 * ---------- Sessions ----------
 * Sessions are kept in the data journal next to the rolls:
 *   flags.<module>.sessions     { <id>: { name, number } }  every session
 *   flags.<module>.liveSession  <id> of the live session, or null
 * `number` counts up (1, 2, 3, ...) and gives the order: there are no dates.
 * Only GMs start and end sessions, and only GMs can write the journal.
 */

/**
 * Every session, newest first.
 * @returns {{ id: string, name: string, number: number, live: boolean }[]}
 */
export function getSessions() {
	const journal = getDataJournal();
	const sessions = journal?.getFlag(moduleId, "sessions") ?? {};
	const liveId = journal?.getFlag(moduleId, "liveSession") ?? null;
	return Object.entries(sessions)
		.map(([id, session]) => ({ id, name: session.name, number: session.number, live: id === liveId }))
		.sort((a, b) => b.number - a.number);
}

/** The live session, or null if rolls are currently between sessions. */
export function getLiveSession() {
	return getSessions().find((session) => session.live) ?? null;
}

/** The number the next session will get, e.g. 5 for "Session 5". */
export function getNextSessionNumber() {
	const highest = getSessions()[0]?.number ?? 0;
	return highest + 1;
}

/**
 * Start a new session and make it the live one (GM only).
 * @param {string} name  The session's name; empty means "Session N".
 */
export async function startSession(name) {
	const journal = await getOrCreateDataJournal();
	if (!journal || getLiveSession()) return;

	const number = getNextSessionNumber();
	const id = foundry.utils.randomID();
	const finalName = name.trim() || game.i18n.format("LRT.Sessions.defaultName", { number });

	// One update for both changes, so nobody ever sees a half-started session.
	await journal.update({
		[`flags.${moduleId}.sessions.${id}`]: { name: finalName, number },
		[`flags.${moduleId}.liveSession`]: id,
	});
}

/** End the live session: rolls are between sessions again (GM only). */
export async function endSession() {
	const journal = getDataJournal();
	if (!journal) return;
	await journal.update({ [`flags.${moduleId}.liveSession`]: null });
}

/**
 * Save many fake rolls at once (GM only; used by the fake data generator).
 * They're all sent in ONE update, so 500 rolls cost one save, not 500.
 * @param {object[]} records  Fake roll records (each has `fake: true`).
 */
export async function saveFakeRolls(records) {
	const journal = await getOrCreateDataJournal();
	if (!journal) return;

	const changes = {};
	for (const record of records) {
		changes[`flags.${moduleId}.rolls.${foundry.utils.randomID()}`] = record;
	}
	await journal.update(changes);
}

/** How many fake rolls are saved. */
export function countFakeRolls() {
	return getRolls().filter((roll) => roll.fake).length;
}

/**
 * Remove every fake roll, leaving real rolls untouched (GM only).
 * To delete a saved entry, Foundry needs a special "ForcedDeletion" value
 * in its place: a plain `null` or a missing key would leave it as it is.
 */
export async function wipeFakeRolls() {
	const journal = getDataJournal();
	if (!journal) return;

	const { ForcedDeletion } = foundry.data.operators;
	const rolls = journal.getFlag(moduleId, "rolls") ?? {};
	const deletions = {};
	for (const [key, roll] of Object.entries(rolls)) {
		if (roll.fake) deletions[key] = new ForcedDeletion();
	}
	if (Object.keys(deletions).length === 0) return;

	await journal.update({ flags: { [moduleId]: { rolls: deletions } } });
}

/** Find the data journal, creating it first if it doesn't exist yet (GM only). */
async function getOrCreateDataJournal() {
	const existing = getDataJournal();
	if (existing) return existing;

	return JournalEntry.create({
		name: game.i18n.localize("LRT.DataJournalName"),
		// "default" ownership applies to every non-GM user. OBSERVER means they
		// can read it but not change it; GMs can always edit everything.
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
		flags: { [moduleId]: { dataJournal: true, rolls: {} } },
	});
}

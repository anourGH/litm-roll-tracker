// Roll capture: turns each litmv2 roll into a "roll record", a plain object
// holding everything the tracker needs to know about that roll, and hands it
// to storage.js to be saved.

import { recordRoll } from "./storage.js";

/**
 * Start listening for rolls. Called once from main.js during "init".
 * @param {string} moduleId  Our module id, used to label console output.
 */
export function registerRollCapture(moduleId) {
	// litmv2 announces every finished roll with its own hook, "litm.roll".
	// It fires once, on the computer of the person who pressed Roll, and
	// hands us the roll and the chat message that was posted for it.
	Hooks.on("litm.roll", (roll, message) => {
		const record = buildRollRecord(roll, message);

		// No record means the roll wasn't made for a hero, so we skip it.
		if (!record) return;

		console.log(`${moduleId} | Roll captured`, record);
		recordRoll(record);
	});
}

/**
 * Build a roll record from a litmv2 roll and its chat message.
 * @param {Roll} roll         The LitmRoll that was just made.
 * @param {ChatMessage} message  The chat message litmv2 posted for it.
 * @returns {object|null}     The roll record, or null if no hero was involved.
 */
export function buildRollRecord(roll, message) {
	// litmv2 keeps its extra roll details (type, tags, power, ...) in
	// roll.options, and exposes them through the shortcut "roll.litm".
	const details = roll.litm;

	const heroIds = getHeroIds(details);
	if (heroIds.length === 0) return null;

	// roll.dice lists the dice parts of the roll (for "2d6 + 3", the "2d6").
	// We add up each part's total the same way litmv2 does when it decides
	// the outcome, so our numbers always match the chat card.
	const diceTotal = roll.dice.reduce((sum, die) => sum + die.total, 0);

	return {
		messageId: message?.id ?? null,
		time: Date.now(),

		// Who: the hero(es) the roll counts for, and the user who pressed Roll.
		heroIds,
		// Hero names, for reading the console more easily. The ids above are
		// what really identifies a hero: names can be changed at any time.
		heroNames: heroIds.map((id) => game.actors.get(id)?.name),
		actingTogether: (details.participantIds?.length ?? 0) > 0,
		userId: message?.author?.id ?? game.user.id,
		rollMode: getRollMode(message),

		// What kind of roll: quick, tracked, mitigate or sacrifice.
		type: details.type ?? "quick",

		// The dice. "raw" keeps each die's actual result.
		// "faces" should always be 6: litmv2's "Themed Dice" setting only
		// changes how dice look (tested with Dice So Nice). We record it
		// anyway as a guard, in case a future litmv2 update changes the dice.
		dice: {
			faces: roll.dice[0]?.faces ?? 6,
			raw: roll.dice.flatMap((die) =>
				die.results.filter((result) => result.active).map((result) => result.result),
			),
			total: diceTotal,
		},

		// Power going INTO the roll (from tags, statuses, Might, ...).
		power: details.totalPower ?? 0,
		// Power left to SPEND after the roll (0 on consequences, null for
		// roll types that don't give Power: quick and sacrifice).
		spendablePower: roll.power,
		total: roll.total,

		// The result as litmv2 judged it: "success", "snc" (success with
		// consequences) or "consequences".
		outcome: roll.outcome.label,
		pushed: Boolean(details.pushed),

		// Every tag and status that went into the roll (see getRollTags).
		tags: getRollTags(details),
	};
}

/**
 * List the tags and statuses used in a roll, in a small format of our own.
 *
 * litmv2 sorts the roll's tags into five lists. A burned tag is ONLY in
 * "scratchedTags", not in "powerTags", so we read all five lists.
 *
 * Each saved tag looks like:
 *   { uuid, name, type, state, ownerId }        (+ value for statuses,
 *                                                 + concealed if hidden)
 * - uuid:    the tag's unique id, e.g. "Actor.abc.Item.def.ActiveEffect.ghi".
 *            We count tags by uuid, so renaming a tag doesn't split its stats.
 * - name:    the name at the time of the roll, kept for tags deleted later.
 * - type:    "power_tag", "weakness_tag", "fellowship_tag",
 *            "relationship_tag", "story_tag" or "status_tag".
 * - state:   "positive" (helped), "negative" (hindered) or "scratched" (burned).
 * - ownerId: the actor the tag belongs to. For a tag another hero contributed
 *            (Helping Each Other) that's the helper, so the tag counts for them.
 * - value:   statuses only: the tier that counted toward Power.
 * - concealed: true if the tag was hidden from players when rolled.
 * @param {object} details  roll.litm
 * @returns {object[]}
 */
function getRollTags(details) {
	const lists = [
		details.scratchedTags,
		details.powerTags,
		details.weaknessTags,
		details.positiveStatuses,
		details.negativeStatuses,
	];

	const tags = [];
	const seen = new Set();
	for (const tag of lists.flat()) {
		// Skip empty entries and any tag already listed.
		if (!tag?.uuid || seen.has(tag.uuid)) continue;
		seen.add(tag.uuid);

		const saved = {
			uuid: tag.uuid,
			name: tag.name ?? "",
			type: tag.type ?? null,
			state: tag.state ?? null,
			ownerId: getTagOwnerId(tag),
		};
		if (tag.type === "status_tag") saved.value = getStatusValue(tag);
		// Only saved when true, to keep records small.
		if (tag.concealedAtRoll) saved.concealed = true;

		tags.push(saved);
	}
	return tags;
}

/**
 * Find the actor a tag belongs to. litmv2 usually tells us ("tagActorId").
 * If not, the owner is in the tag's uuid: "Actor.<id>.…" means that actor.
 * Scene story tags may have no actor at all, which gives null.
 */
function getTagOwnerId(tag) {
	if (tag.tagActorId) return tag.tagActorId;
	return /^Actor\.([^.]+)\./.exec(tag.uuid)?.[1] ?? null;
}

/** A status's tier, read the same way litmv2 reads it when adding up Power. */
function getStatusValue(tag) {
	const tier = tag.system?.currentTier ?? Number.parseInt(tag.value, 10);
	return Number.isFinite(tier) ? tier : 0;
}

/**
 * Work out which hero(es) a roll counts for.
 * Acting Together rolls are made by the Fellowship actor and list every
 * participating hero in "participantIds"; the roll counts for each of them.
 * Any other roll counts for the actor that rolled, if it's a hero.
 */
function getHeroIds(details) {
	const participantIds = details.participantIds ?? [];
	const candidateIds = participantIds.length > 0 ? participantIds : [details.actorId];

	// Keep only ids that belong to existing hero actors.
	return candidateIds.filter((id) => game.actors.get(id)?.type === "hero");
}

/**
 * Work out the roll mode from who the chat message was shown to.
 * - blind:   flagged blind (only GMs see the result)
 * - public:  not whispered to anyone, so everyone sees it
 * - self:    whispered only to the person who rolled
 * - private: whispered to GMs (a "private GM roll")
 * Edge case: a GM making a private GM roll in a game with only one GM
 * looks the same as a self roll; both are hidden from players anyway.
 */
function getRollMode(message) {
	if (!message) return "public";
	if (message.blind) return "blind";

	const whisper = message.whisper ?? [];
	if (whisper.length === 0) return "public";
	if (whisper.length === 1 && whisper[0] === message.author?.id) return "self";
	return "private";
}

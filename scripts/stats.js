// Stats: turns a list of roll records into the numbers the tabs show.
//
// These functions only do arithmetic on plain data. They don't draw anything
// or change any document, which makes them easy to check by hand now and to
// cover with automated tests (Vitest) later. Looking up current tag names is
// the one exception (see getFavoriteTag), since names can change.

/** Outcomes that count as a success (success with consequences included). */
const SUCCESS_OUTCOMES = new Set(["success", "snc"]);

/** The three outcomes, in the order the Summary shows them. */
export const OUTCOMES = ["success", "snc", "consequences"];

/** True if a roll counts as a success. */
export function isSuccess(roll) {
	return SUCCESS_OUTCOMES.has(roll.outcome);
}

/**
 * The average of a number taken from each roll, e.g. its Power.
 * @param {object[]} rolls
 * @param {(roll: object) => number} getValue
 * @returns {number|null}  null when there are no rolls to average.
 */
export function average(rolls, getValue) {
	const values = rolls.map(getValue).filter((value) => Number.isFinite(value));
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * How many rolls had each outcome, and what share of all rolls that is.
 * @returns {{ outcome: string, count: number, percent: number }[]}
 */
export function getOutcomeSplit(rolls) {
	return OUTCOMES.map((outcome) => {
		const count = rolls.filter((roll) => roll.outcome === outcome).length;
		const percent = rolls.length > 0 ? Math.round((count / rolls.length) * 100) : 0;
		return { outcome, count, percent };
	});
}

/**
 * The success streak: successes (or successes with consequences) in a row.
 * - current: the streak still going at the most recent roll (0 if the last
 *   roll was a consequences).
 * - longest: the longest streak at any point.
 * @param {object[]} rolls  In any order; sorted by time here.
 */
export function getSuccessStreak(rolls) {
	const ordered = [...rolls].sort((a, b) => a.time - b.time);
	let current = 0;
	let longest = 0;
	for (const roll of ordered) {
		current = isSuccess(roll) ? current + 1 : 0;
		longest = Math.max(longest, current);
	}
	return { current, longest };
}

/** How many recent rolls the Dice tab's average looks at. */
export const RECENT_ROLL_COUNT = 10;
/** Recent average at or above this is a hot streak. */
export const HOT_STREAK_AVERAGE = 8;
/** Recent average at or below this is a cold streak. */
export const COLD_STREAK_AVERAGE = 6;

/**
 * How often each dice total (2–12) came up. Power is NOT included: this is
 * just the two dice, so it shows luck rather than skill.
 * @returns {{ total: number, count: number }[]}  One entry per total, 2 to 12.
 */
export function getDiceHistogram(rolls) {
	const counts = new Map();
	for (let total = 2; total <= 12; total++) counts.set(total, 0);
	for (const roll of rolls) {
		const total = roll.dice?.total;
		if (counts.has(total)) counts.set(total, counts.get(total) + 1);
	}
	return [...counts].map(([total, count]) => ({ total, count }));
}

/**
 * The average dice total of the most recent rolls, and whether that's a hot
 * or cold streak. With fewer than RECENT_ROLL_COUNT rolls, there's no average
 * yet, only how many rolls have been made so far.
 *
 * Why 8.0 and 6.0: two dice average 7. Over 10 rolls, an average of 8+ or
 * 6- each happens by chance only about 1 time in 9, so it feels notable.
 * @returns {{ average: number|null, streak: "hot"|"cold"|null, rollsSoFar: number }}
 */
export function getRecentAverage(rolls) {
	const recent = [...rolls].sort((a, b) => b.time - a.time).slice(0, RECENT_ROLL_COUNT);
	if (recent.length < RECENT_ROLL_COUNT) {
		return { average: null, streak: null, rollsSoFar: recent.length };
	}

	const value = average(recent, (roll) => roll.dice?.total);
	let streak = null;
	if (value >= HOT_STREAK_AVERAGE) streak = "hot";
	else if (value <= COLD_STREAK_AVERAGE) streak = "cold";
	return { average: value, streak, rollsSoFar: recent.length };
}

/**
 * How many rolls came up double 1s and double 6s.
 * @returns {{ ones: number, sixes: number }}
 */
export function countDoubles(rolls) {
	let ones = 0;
	let sixes = 0;
	for (const roll of rolls) {
		const [first, second] = roll.dice?.raw ?? [];
		if (first !== second) continue;
		if (first === 1) ones += 1;
		if (first === 6) sixes += 1;
	}
	return { ones, sixes };
}

/**
 * Count how each tag was used, ranked from most to least used.
 *
 * Tags count toward the hero who OWNS them, so this looks at every roll in
 * the range, not only the hero's own: a tag a hero contributed to someone
 * else's roll (Helping Each Other) still counts for that hero.
 *
 * @param {object[]} rolls     Every roll in the selected range.
 * @param {object} options
 * @param {Set<string>} options.types  Tag types to count, e.g. "power_tag".
 * @param {string|null} options.ownerId  Only count this hero's tags; null for
 *   "All heroes".
 * @param {(tag: object) => boolean} [options.only]  Extra filter, e.g. only
 *   burned uses. By default every use counts: helped, hindered or burned.
 * @returns {{ uuid, name, ownerId, targetId, count, successes, lastUsed }[]}
 *   Most used first; ties go to the most recently used. Deleted tags are
 *   left out, and names are the tags' current names.
 */
export function rankTags(rolls, { types, ownerId, only = () => true }) {
	const usage = new Map();

	for (const roll of rolls) {
		// Records saved before tag details existed only hold counts: skip them.
		if (!Array.isArray(roll.tags)) continue;

		for (const tag of roll.tags) {
			if (!types.has(tag.type)) continue;
			if (ownerId && tag.ownerId !== ownerId) continue;
			if (!only(tag)) continue;

			const entry = usage.get(tag.uuid) ?? {
				uuid: tag.uuid,
				name: tag.name,
				ownerId: tag.ownerId,
				count: 0,
				successes: 0,
				lastUsed: 0,
			};
			entry.count += 1;
			if (isSuccess(roll)) entry.successes += 1;
			entry.lastUsed = Math.max(entry.lastUsed, roll.time ?? 0);
			usage.set(tag.uuid, entry);
		}
	}

	const ranked = [];
	for (const entry of usage.values()) {
		// fromUuidSync finds a document from its uuid without waiting. If the
		// tag was deleted, it finds nothing, and the tag is left out.
		const tagDocument = foundry.utils.fromUuidSync(entry.uuid, { strict: false });
		if (!tagDocument) continue;

		// Show the tag's current name, in case it was renamed since.
		// Relationship tags also say who they're with (litmv2 keeps that
		// hero's id in system.targetId).
		ranked.push({
			...entry,
			name: tagDocument.name ?? entry.name,
			targetId: tagDocument.system?.targetId || null,
		});
	}
	return ranked.sort(byCountThenRecent);
}

/** Sort order: most used first; on a tie, the one used most recently. */
function byCountThenRecent(a, b) {
	return b.count - a.count || b.lastUsed - a.lastUsed;
}

/** The single most used tag of a kind (Summary's favorites), or null. */
export function getFavoriteTag(rolls, options) {
	return rankTags(rolls, options)[0] ?? null;
}

/** How many uses a tag needs before it can be a "lucky tag". */
export const LUCKY_MIN_USES = 3;

/**
 * Lucky tags: the tags with the best success rate (success or success with
 * consequences), among tags used at least LUCKY_MIN_USES times. Ties go to
 * the tag used more often, then to the most recently used.
 * @returns {{ uuid, name, ownerId, count, successes, rate }[]}
 */
export function getLuckyTags(rolls, options) {
	return rankTags(rolls, options)
		.filter((tag) => tag.count >= LUCKY_MIN_USES)
		.map((tag) => ({ ...tag, rate: tag.successes / tag.count }))
		.sort((a, b) => b.rate - a.rate || byCountThenRecent(a, b));
}

/**
 * Burned tags: how often each tag was burned (scratched) for Power, plus the
 * total number of burns.
 * @returns {{ tags: object[], total: number }}
 */
export function getBurnedTags(rolls, options) {
	const tags = rankTags(rolls, { ...options, only: (tag) => tag.state === "scratched" });
	const total = tags.reduce((sum, tag) => sum + tag.count, 0);
	return { tags, total };
}

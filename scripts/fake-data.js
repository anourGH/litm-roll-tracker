// Fake data: builds made-up roll records for testing the stats screens.
//
// Fake rolls have the same shape as real ones (see roll-capture.js), plus
// `fake: true` so they can be wiped without touching real rolls. They use
// each hero's real tags, so the Tags tab and favorites look like real play.
//
// Power and outcome follow litmv2's own rules, so the numbers are believable:
// - Power: +1 per helping tag, +3 for a burned tag, −1 per weakness tag,
//   plus the highest helping status tier, minus the highest hindering one.
// - Outcome, from the two dice plus Power: 10 or more is a success, 7–9 is a
//   success with consequences, 6 or less is consequences. Rolling 2 on the
//   dice is always consequences, and 12 is always a success.

// The most rolls per hero the generator allows in one go.
export const MAX_ROLLS_PER_HERO = 500;

// About how often a fake roll is an Acting Together roll.
const ACTING_TOGETHER_CHANCE = 0.1;
// How often a fake roll also uses a Fellowship tag: 1 in 40.
const FELLOWSHIP_TAG_CHANCE = 1 / 40;
// Power from burning a tag (litmv2's BURN_POWER).
const BURN_POWER = 3;

/**
 * Build fake roll records.
 * `count` rolls are made per hero. About 1 in 10 of them is an Acting
 * Together roll that counts for every chosen hero, so each hero ends up
 * with a few more rolls than `count` when several heroes are chosen.
 * @param {string[]} heroIds  The heroes to make rolls for.
 * @param {number} count      Rolls per hero.
 * @returns {object[]}        The fake roll records.
 */
export function buildFakeRolls(heroIds, count) {
	const heroes = heroIds.map((id) => game.actors.get(id)).filter(Boolean);
	const fellowship = game.litmv2?.fellowship ?? null;

	// Read each actor's tags once, not once per roll.
	const tagsByActor = new Map(heroes.map((hero) => [hero.id, getActorTags(hero)]));
	const fellowshipTags = fellowship ? getActorTags(fellowship) : null;

	const records = [];
	// Spread the rolls over the last 30 days, oldest first, so History has an
	// order. Times are only used for sorting; they're never shown.
	const total = heroes.length * count;
	const start = Date.now() - 30 * 24 * 60 * 60 * 1000;
	const step = total > 0 ? (Date.now() - start) / total : 0;

	for (let i = 0; i < count; i++) {
		for (const hero of heroes) {
			const time = Math.round(start + records.length * step);
			const actingTogether = heroes.length > 1 && Math.random() < ACTING_TOGETHER_CHANCE;
			const rollers = actingTogether ? heroes : [hero];

			// Pick tags from the heroes taking part (and sometimes the Fellowship).
			const tags = pickTags(rollers.map((h) => tagsByActor.get(h.id)), fellowshipTags);
			records.push(buildRecord({ heroes: rollers, tags, time, actingTogether }));
		}
	}
	return records;
}

/**
 * Sort an actor's tags into the groups we pick from. Burned (scratched)
 * tags are left out, since they can't be used until recovered.
 * @param {Actor} actor
 */
function getActorTags(actor) {
	const groups = { power: [], weakness: [], relationship: [], fellowship: [], status: [] };

	// allApplicableEffects() lists every effect on the actor, including those
	// on its theme items. litmv2 tags and statuses are effects.
	for (const effect of actor.allApplicableEffects()) {
		if (effect.system?.isScratched) continue;
		const tag = {
			uuid: effect.uuid,
			name: effect.name,
			type: effect.type,
			ownerId: actor.id,
		};

		switch (effect.type) {
			case "power_tag": groups.power.push(tag); break;
			case "weakness_tag": groups.weakness.push(tag); break;
			case "relationship_tag": groups.relationship.push(tag); break;
			case "fellowship_tag": groups.fellowship.push(tag); break;
			case "status_tag": groups.status.push(tag); break;
		}
	}
	return groups;
}

/**
 * Choose the tags for one roll.
 * @param {object[]} heroTagGroups  getActorTags() results for the rollers.
 * @param {object|null} fellowshipTags  getActorTags() for the Fellowship.
 * @returns {object[]}  Tags in the saved format (with `state`).
 */
function pickTags(heroTagGroups, fellowshipTags) {
	const tags = [];
	const used = new Set();
	const add = (tag, state) => {
		if (!tag || used.has(tag.uuid)) return;
		used.add(tag.uuid);
		tags.push({ ...tag, state });
	};

	// Each roller adds 0–2 power tags, sometimes a weakness or relationship.
	for (const groups of heroTagGroups) {
		const powerCount = randomInt(0, 2);
		for (let i = 0; i < powerCount; i++) add(pick(groups.power), "positive");
		if (Math.random() < 0.3) add(pick(groups.weakness), "negative");
		if (Math.random() < 0.15) add(pick(groups.relationship), Math.random() < 0.8 ? "positive" : "negative");
		if (Math.random() < 0.15) {
			const status = pick(groups.status);
			if (status) add({ ...status, value: randomInt(1, 3) }, Math.random() < 0.6 ? "positive" : "negative");
		}
	}

	// Now and then a Fellowship tag helps.
	if (fellowshipTags && Math.random() < FELLOWSHIP_TAG_CHANCE) {
		add(pick([...fellowshipTags.fellowship, ...fellowshipTags.power]), "positive");
	}

	// Occasionally one helping power tag is burned instead (only one burn per
	// roll). Only power tags can be burned: Fellowship and relationship tags
	// can't (litmv2 marks those as unburnable).
	const burnable = tags.filter((tag) => tag.state === "positive" && tag.type === "power_tag");
	if (burnable.length > 0 && Math.random() < 0.08) pick(burnable).state = "scratched";

	return tags;
}

/** Build one fake record in the same shape roll-capture.js saves. */
function buildRecord({ heroes, tags, time, actingTogether }) {
	const type = weightedPick({ quick: 45, tracked: 40, mitigate: 15 });
	const pushed = Math.random() < 0.05;
	const raw = [randomInt(1, 6), randomInt(1, 6)];
	const diceTotal = raw[0] + raw[1];
	const power = getPower(tags);
	const total = diceTotal + power;
	const outcome = getOutcome(diceTotal, total, pushed);

	return {
		fake: true,
		messageId: null,
		time,
		heroIds: heroes.map((hero) => hero.id),
		actingTogether,
		userId: getPlayerId(pick(heroes)),
		rollMode: weightedPick({ public: 80, private: 10, blind: 5, self: 5 }),
		type,
		dice: { faces: 6, raw, total: diceTotal },
		power,
		// Quick rolls give no Power to spend; consequences give 0; otherwise
		// at least 1 (litmv2's rule of minimum one).
		spendablePower: type === "quick" ? null : outcome === "consequences" ? 0 : Math.max(power, 1),
		total,
		outcome,
		pushed,
		tags,
	};
}

/** Power going into the roll, from its tags and statuses. */
function getPower(tags) {
	let power = 0;
	let bestHelp = 0;
	let worstHinder = 0;
	for (const tag of tags) {
		if (tag.type === "status_tag") {
			if (tag.state === "positive") bestHelp = Math.max(bestHelp, tag.value);
			else worstHinder = Math.max(worstHinder, tag.value);
		} else if (tag.state === "scratched") power += BURN_POWER;
		else if (tag.state === "positive") power += 1;
		else if (tag.state === "negative") power -= 1;
	}
	return power + bestHelp - worstHinder;
}

/** The outcome, following litmv2's rules (see the top of this file). */
function getOutcome(diceTotal, total, pushed) {
	if (diceTotal === 2) return "consequences";
	if (diceTotal === 12 || total >= 10) return pushed ? "snc" : "success";
	if (total >= 7) return "snc";
	return "consequences";
}

/** The player whose character this hero is, or the GM if nobody has it. */
function getPlayerId(hero) {
	const player = game.users.find((user) => !user.isGM && user.character?.id === hero.id);
	return player?.id ?? game.user.id;
}

/** A whole number from min to max, both included. */
function randomInt(min, max) {
	return min + Math.floor(Math.random() * (max - min + 1));
}

/** A random item from a list, or undefined if the list is empty. */
function pick(list) {
	return list[Math.floor(Math.random() * list.length)];
}

/** Pick a key at random, where bigger weights are more likely. */
function weightedPick(weights) {
	const entries = Object.entries(weights);
	let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
	for (const [key, weight] of entries) {
		roll -= weight;
		if (roll < 0) return key;
	}
	return entries[0][0];
}

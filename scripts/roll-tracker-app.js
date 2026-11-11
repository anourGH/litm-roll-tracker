import {
	average,
	countDoubles,
	getBurnedTags,
	getDiceHistogram,
	getFavoriteTag,
	getLuckyTags,
	getOutcomeSplit,
	getRecentAverage,
	getSuccessStreak,
	isSuccess,
	rankTags,
	RECENT_ROLL_COUNT,
} from "./stats.js";
import { getRolls, getSessions, isTrackingPaused } from "./storage.js";

const MODULE_ID = "litm-roll-tracker";

// The value the hero dropdown uses for "All heroes".
const ALL_HEROES = "all";
// The value the range dropdown uses for "All time".
const ALL_TIME = "all";
// Foundry's built-in "unknown person" image, used when an actor has no image.
const FALLBACK_IMAGE = "icons/svg/mystery-man.svg";
// How many History rows to show at first, and to add with each "Show more".
const HISTORY_PAGE_SIZE = 25;
// litmv2's outcome icons. We point to them instead of copying them into our
// module (their license doesn't allow copying). If one fails to load, the
// History tab shows our fallback icon instead (see _onRender).
const OUTCOME_ICON_PATH = "systems/litmv2/assets/media/icons";
const OUTCOME_FALLBACK_ICONS = {
	success: "fa-solid fa-circle-check",
	snc: "fa-solid fa-circle-half-stroke",
	consequences: "fa-solid fa-circle-xmark",
};
// The order tag groups are listed in when a History row is expanded.
const TAG_TYPE_ORDER = ["power_tag", "fellowship_tag", "relationship_tag", "story_tag", "weakness_tag", "status_tag"];

// ApplicationV2 is Foundry's current base class for windows.
// HandlebarsApplicationMixin adds the ability to draw it from .hbs templates.
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The main Roll Tracker window: header (hero, range, headline) and four tabs.
 */
export class RollTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
	/**
	 * Settings for the window itself. Foundry merges these with the defaults
	 * from ApplicationV2, so we only list what we want to change.
	 */
	static DEFAULT_OPTIONS = {
		// The HTML id of the window. Only one window with this id can be open.
		id: "lrt-roll-tracker",
		// lrt--themed: our shared fonts and light/dark colors (roll-tracker.css).
		classes: ["lrt--roll-tracker", "lrt--themed"],
		window: {
			title: "LRT.Window.title",
			icon: "fa-solid fa-dice",
			resizable: true,
		},
		position: {
			width: 1020,
			height: 500,
		},
		// Clicking an element with data-action="openSheet" calls #onOpenSheet.
		actions: {
			openSheet: RollTrackerApp.#onOpenSheet,
			toggleRoll: RollTrackerApp.#onToggleRoll,
			showMore: RollTrackerApp.#onShowMore,
		},
	};

	/**
	 * Portrait clicked: open that actor's sheet. The actor's id is stored on
	 * the button as data-actor-id (read here as `target.dataset.actorId`).
	 */
	static #onOpenSheet(_event, target) {
		const actor = game.actors.get(target.dataset.actorId);
		actor?.sheet?.render({ force: true });
	}

	/**
	 * A History row clicked: show or hide its details. This only flips a CSS
	 * class, so nothing is redrawn and the list doesn't jump. The open rows
	 * are remembered, so they stay open after "Show more" redraws the list.
	 */
	static #onToggleRoll(_event, target) {
		const row = target.closest(".lrt--history-row");
		const id = row?.dataset.rollId;
		if (!id) return;

		const expanded = row.classList.toggle("lrt--expanded");
		target.setAttribute("aria-expanded", String(expanded));
		if (expanded) this.expandedRolls.add(id);
		else this.expandedRolls.delete(id);
	}

	/**
	 * "Show more" clicked: show 25 more History rows. `parts: ["tabs"]` redraws
	 * only the tabs part, not the header.
	 */
	static #onShowMore() {
		this.historyLimit += HISTORY_PAGE_SIZE;
		this.render({ parts: ["tabs"] });
	}

	/**
	 * The window is drawn in "parts", each from its own template. Splitting it
	 * up lets us redraw one part later (e.g. History's "Show more") without
	 * redrawing the whole window.
	 */
	static PARTS = {
		header: {
			template: `modules/${MODULE_ID}/templates/header.hbs`,
		},
		tabs: {
			template: `modules/${MODULE_ID}/templates/tabs.hbs`,
			// Each tab's content is its own small template, loaded as a "partial"
			// (a template used inside another one with {{> "path"}}).
			templates: [
				`modules/${MODULE_ID}/templates/tab-summary.hbs`,
				`modules/${MODULE_ID}/templates/tab-tags.hbs`,
				`modules/${MODULE_ID}/templates/tab-dice.hbs`,
				`modules/${MODULE_ID}/templates/tab-history.hbs`,
				`modules/${MODULE_ID}/templates/person.hbs`,
			],
			// Foundry remembers how far these elements were scrolled and puts
			// them back after a redraw, so "Show more" doesn't jump to the top.
			scrollable: ["section.lrt--tab[data-tab='history']"],
		},
	};

	/**
	 * Foundry's native tabs. Each group ("primary" here) is a set of tabs where
	 * one is shown at a time. Clicking an element with data-action="tab" in the
	 * template switches tabs for us, and Foundry remembers the open tab in
	 * `this.tabGroups`, so reopening the window keeps it.
	 */
	static TABS = {
		primary: {
			tabs: [
				{ id: "summary", label: "LRT.Tabs.summary" },
				{ id: "tags", label: "LRT.Tabs.tags" },
				{ id: "dice", label: "LRT.Tabs.dice" },
				{ id: "history", label: "LRT.Tabs.history" },
			],
			initial: "summary",
		},
	};

	/**
	 * Opens the window, or brings it to the front and refreshes it if it's
	 * already open. We keep one shared window instead of making a new one per
	 * click.
	 */
	static open() {
		this.instance ??= new this();
		// Each time the window is opened (not just brought forward), the range
		// goes back to its default, so a session started since last time
		// shows up straight away.
		if (!this.instance.rendered) this.instance.rangeId = null;
		// `force: true` means "draw it even if it isn't open yet".
		this.instance.render({ force: true });
	}

	/**
	 * What's selected in the dropdowns. These live on the window, so they're
	 * remembered while it stays open, and the range is kept when switching
	 * heroes. `null` means "not chosen yet": the defaults are worked out on the
	 * next draw (see pickHeroId and pickRangeId).
	 */
	heroId = null;
	rangeId = null;

	/** How many History rows are shown; grows with each "Show more". */
	historyLimit = HISTORY_PAGE_SIZE;
	/** The ids of History rows that are expanded. */
	expandedRolls = new Set();

	/**
	 * Foundry calls this before every draw. It gathers the data the templates
	 * need (the "context"). Each {{name}} in a template reads `context.name`.
	 * Because it runs on every draw, reopening the window shows fresh data.
	 */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const heroes = getHeroes();
		this.heroId = pickHeroId(this.heroId, heroes);
		const hero = game.actors.get(this.heroId);

		// Dropdown choices, as { value, label } pairs for the selectOptions helper.
		context.heroOptions = [
			{ value: ALL_HEROES, label: game.i18n.localize("LRT.Window.allHeroes") },
			...heroes.map((h) => ({ value: h.id, label: h.name })),
		];
		context.heroId = this.heroId;

		// Range: "All time", then every session, newest first.
		const sessions = getSessions();
		this.rangeId = pickRangeId(this.rangeId, sessions);
		context.rangeOptions = [
			{ value: ALL_TIME, label: game.i18n.localize("LRT.Window.allTime") },
			...sessions.map((session) => ({
				value: session.id,
				label: session.live
					? game.i18n.format("LRT.Sessions.liveLabel", { name: session.name })
					: session.name,
			})),
		];
		context.rangeId = this.rangeId;

		// "All heroes" uses the Fellowship's image, since it stands for the group.
		const portraitActor = hero ?? game.actors.get(game.litmv2?.fellowship?.id);
		context.portrait = portraitActor?.img || FALLBACK_IMAGE;
		// The portrait opens the actor's sheet, but only if this user may see
		// it: LIMITED is the lowest permission that can open a sheet at all.
		context.portraitActorId = portraitActor?.testUserPermission(game.user, "LIMITED") ? portraitActor.id : null;
		context.portraitTooltip = portraitActor
			? game.i18n.format("LRT.Window.openSheet", { name: portraitActor.name })
			: null;
		context.playedBy = hero ? getPlayedBy(hero) : null;

		// The rolls for this selection. Everything below the header is built
		// from these. With none, the template shows the "No data" screen.
		// `rangeRolls`: every roll in the selected range, for any hero. Favorite
		// tags need these, since a hero's tag can be used in someone else's roll.
		const rangeRolls = filterRange(getRolls(), this.rangeId);
		const rolls = filterRolls(rangeRolls, this.heroId);
		context.hasRolls = rolls.length > 0;
		context.trackingPaused = isTrackingPaused();
		if (context.hasRolls) {
			context.headline = getHeadline(rolls);
			context.summary = buildSummary(rolls, rangeRolls, hero);
			context.tags = buildTags(rangeRolls, hero);
			context.dice = buildDice(rolls);
			context.history = buildHistory(rolls, this.historyLimit, this.expandedRolls, sessions);
		}

		// One entry per tab with its label and whether it's the open one
		// (`cssClass` is "active" for the open tab).
		context.tabs = this._prepareTabs("primary");

		return context;
	}

	/**
	 * Foundry calls this after every draw, once the HTML is on the page. It's
	 * where we connect our code to the HTML, such as listening for a dropdown
	 * change. A redraw replaces the HTML, so this runs again each time.
	 */
	_onRender(context, options) {
		super._onRender(context, options);

		// Only when the header was just drawn: "Show more" redraws only the tabs
		// part, and the header's dropdowns would otherwise collect a second
		// copy of the same listener each time. `options.parts` lists the parts
		// drawn this time.
		if (options.parts.includes("header")) {
			this.element.querySelector("[name='hero']")?.addEventListener("change", (event) => {
				this.heroId = event.target.value;
				this.#resetHistory();
				this.render();
			});
			this.element.querySelector("[name='range']")?.addEventListener("change", (event) => {
				this.rangeId = event.target.value;
				this.#resetHistory();
				this.render();
			});
		}

		// If litmv2's outcome icon can't load (e.g. a future litmv2 moves it),
		// hide the broken image and show our fallback icon next to it instead.
		for (const img of this.element.querySelectorAll("img.lrt--outcome-icon")) {
			const useFallback = () => {
				img.hidden = true;
				img.nextElementSibling?.removeAttribute("hidden");
			};
			// "complete" with no width means it already failed before we got here.
			if (img.complete && img.naturalWidth === 0) useFallback();
			else img.addEventListener("error", useFallback, { once: true });
		}
	}

	/** A new hero or range starts History over: first page, nothing expanded. */
	#resetHistory() {
		this.historyLimit = HISTORY_PAGE_SIZE;
		this.expandedRolls.clear();
	}
}

/**
 * Decide which range to show.
 * - Keep the current choice if it's "All time" or a session that still exists.
 * - When not chosen yet (window just opened): the live session if there is
 *   one, otherwise "All time".
 */
function pickRangeId(currentId, sessions) {
	if (currentId === ALL_TIME || sessions.some((session) => session.id === currentId)) return currentId;
	if (currentId === null) return sessions.find((session) => session.live)?.id ?? ALL_TIME;
	return ALL_TIME;
}

/**
 * Keep the rolls in the chosen range: everything for "All time", or only one
 * session's rolls. Rolls between sessions only appear under "All time".
 */
function filterRange(rolls, rangeId) {
	if (rangeId === ALL_TIME) return rolls;
	return rolls.filter((roll) => roll.sessionId === rangeId);
}

/**
 * Keep the rolls that count for the chosen hero. "All heroes" keeps every
 * roll once (an Acting Together roll is one roll, even with many heroes).
 */
function filterRolls(rolls, heroId) {
	if (heroId === ALL_HEROES) return rolls;
	return rolls.filter((roll) => roll.heroIds?.includes(heroId));
}

/**
 * The headline above the tabs, e.g. "77% successes · 37 of 48 rolls".
 * Success with consequences counts as a success, as in the rules.
 */
function getHeadline(rolls) {
	const successes = rolls.filter(isSuccess).length;
	const percent = Math.round((successes / rolls.length) * 100);

	return {
		percent: game.i18n.format("LRT.Window.headlinePercent", { percent }),
		count: game.i18n.format(rolls.length === 1 ? "LRT.Window.headlineCountOne" : "LRT.Window.headlineCount", {
			successes: formatNumber(successes),
			total: formatNumber(rolls.length),
		}),
	};
}

/**
 * Everything the Summary tab shows, ready for the template: numbers are
 * already formatted as text.
 * @param {object[]} rolls       The selected hero's rolls (or all, for All heroes).
 * @param {object[]} rangeRolls  Every roll in the range, for favorite tags.
 * @param {Actor|undefined} hero The selected hero; undefined for All heroes.
 */
function buildSummary(rolls, rangeRolls, hero) {
	const streak = getSuccessStreak(rolls);

	// Power tags: for one hero, only their own power tags. For All heroes,
	// Fellowship tags count too (they belong to the whole group).
	const powerTypes = hero ? ["power_tag"] : ["power_tag", "fellowship_tag"];
	const favorites = [
		{ label: "LRT.Summary.favoritePower", types: powerTypes, kind: "tag" },
		{ label: "LRT.Summary.favoriteWeakness", types: ["weakness_tag"], kind: "weakness" },
		{ label: "LRT.Summary.favoriteRelationship", types: ["relationship_tag"], kind: "tag" },
	].map(({ label, types, kind }) => {
		const tag = getFavoriteTag(rangeRolls, { types: new Set(types), ownerId: hero?.id ?? null });
		return {
			label,
			// The highlight colour, as in litmv2: "tag" or "weakness".
			kind,
			tag: tag && {
				name: tag.name,
				count: game.i18n.format("LRT.Summary.timesUsed", { count: formatNumber(tag.count) }),
				...describePeople(tag, hero),
			},
		};
	});

	return {
		rollCount: formatNumber(rolls.length),
		averagePower: formatDecimal(average(rolls, (roll) => roll.power)),
		averageDice: formatDecimal(average(rolls, (roll) => roll.dice?.total)),
		streakCurrent: formatNumber(streak.current),
		streakLongest: formatNumber(streak.longest),
		outcomes: getOutcomeSplit(rolls).map((entry) => ({
			...entry,
			label: `LRT.Outcomes.${entry.outcome}`,
			count: formatNumber(entry.count),
			// The raw count sizes the bar segment (CSS flex-grow).
			share: entry.count,
		})),
		favorites,
	};
}

/**
 * Everything the Tags tab shows. Each list always has 3 rows.
 * @param {object[]} rangeRolls  Every roll in the range (tags count for their owner).
 * @param {Actor|undefined} hero The selected hero; undefined for All heroes.
 */
function buildTags(rangeRolls, hero) {
	const ownerId = hero?.id ?? null;
	// Same rule as the Summary: Fellowship tags only count for All heroes.
	const powerTypes = new Set(hero ? ["power_tag"] : ["power_tag", "fellowship_tag"]);
	const timesUsed = (tag) => game.i18n.format("LRT.Summary.timesUsed", { count: formatNumber(tag.count) });

	// Turn a ranked list into exactly 3 rows for the template. Rows past the
	// end of the list are { rank, empty: true }, shown as "No data".
	const topThree = (tags, describe) =>
		Array.from({ length: 3 }, (_, index) => {
			const tag = tags[index];
			if (!tag) return { rank: index + 1, empty: true };
			return {
				rank: index + 1,
				name: tag.name,
				value: describe(tag),
				...describePeople(tag, hero),
			};
		});

	const burned = getBurnedTags(rangeRolls, { types: powerTypes, ownerId });

	return {
		power: topThree(rankTags(rangeRolls, { types: powerTypes, ownerId }), timesUsed),
		weakness: topThree(rankTags(rangeRolls, { types: new Set(["weakness_tag"]), ownerId }), timesUsed),
		lucky: topThree(getLuckyTags(rangeRolls, { types: powerTypes, ownerId }), (tag) =>
			game.i18n.format("LRT.Tags.luckyValue", {
				percent: Math.round(tag.rate * 100),
				successes: formatNumber(tag.successes),
				uses: formatNumber(tag.count),
			}),
		),
		burned: topThree(burned.tags, timesUsed),
		burnedTotal: game.i18n.format("LRT.Tags.burnedTotal", { count: formatNumber(burned.total) }),
		relationship: topThree(rankTags(rangeRolls, { types: new Set(["relationship_tag"]), ownerId }), timesUsed),
	};
}

/**
 * The people to show next to a tag, each as a small portrait plus name:
 * - owner: whose tag it is. Only for "All heroes"; with one hero selected
 *   every tag is theirs, so it would only repeat the header.
 * - target: for relationship tags, who the relationship is with.
 * Either is null when it doesn't apply (or that actor was deleted).
 * @param {object} tag             A ranked tag from stats.js.
 * @param {Actor|undefined} hero   The selected hero; undefined for All heroes.
 */
function describePeople(tag, hero) {
	return {
		owner: hero ? null : describeActor(game.actors.get(tag.ownerId)),
		target: describeActor(game.actors.get(tag.targetId), "LRT.Tags.with"),
	};
}

/**
 * An actor as { img, name, tooltip } for the portrait-and-name templates.
 * @param {Actor|undefined} actor
 * @param {string} [tooltipKey]  Lang key for the hover text, e.g. "with {name}".
 */
function describeActor(actor, tooltipKey) {
	if (!actor) return null;
	return {
		img: actor.img || FALLBACK_IMAGE,
		name: actor.name,
		tooltip: tooltipKey ? game.i18n.format(tooltipKey, { name: actor.name }) : actor.name,
	};
}

/**
 * Everything the History tab shows: the newest rolls first, up to `limit`.
 * @param {object[]} rolls          The selected hero's rolls.
 * @param {number} limit            How many rows to show.
 * @param {Set<string>} expandedIds Rows the user has expanded.
 * @param {object[]} sessions       Every session, for the session column.
 */
function buildHistory(rolls, limit, expandedIds, sessions) {
	// Session id → name, looked up once instead of once per row.
	const sessionNames = new Map(sessions.map((session) => [session.id, session.name]));
	const betweenSessions = game.i18n.localize("LRT.Sessions.between");

	const newestFirst = [...rolls].sort((a, b) => b.time - a.time);
	const shown = newestFirst.slice(0, limit);
	const remaining = newestFirst.length - shown.length;

	return {
		rows: shown.map((roll) =>
			buildHistoryRow(roll, expandedIds.has(roll.id), sessionNames.get(roll.sessionId) ?? betweenSessions),
		),
		showMore: remaining > 0
			? game.i18n.format("LRT.History.showMore", { count: formatNumber(Math.min(remaining, HISTORY_PAGE_SIZE)) })
			: null,
	};
}

/** One History row, plus the details shown when it's expanded. */
function buildHistoryRow(roll, expanded, sessionName) {
	// Acting Together rolls show the Fellowship; others show the hero.
	const fellowship = game.actors.get(game.litmv2?.fellowship?.id);
	const actor = roll.actingTogether ? fellowship : game.actors.get(roll.heroIds?.[0]);
	const rollerId = roll.actingTogether ? null : roll.heroIds?.[0];

	// Heroes who contributed a tag (Helping Each Other), each listed once.
	// They're shown next to the roller's name, but the roll still only
	// counts for the roller.
	const helpers = new Map();
	for (const tag of Array.isArray(roll.tags) ? roll.tags : []) {
		const helper = getHelper(tag, rollerId);
		if (helper && !helpers.has(helper.id)) {
			helpers.set(helper.id, {
				img: helper.img || FALLBACK_IMAGE,
				tooltip: game.i18n.format("LRT.History.helpedBy", { name: helper.name }),
			});
		}
	}

	return {
		id: roll.id,
		expanded,
		img: actor?.img || FALLBACK_IMAGE,
		name: actor?.name ?? game.i18n.localize("LRT.History.unknownHero"),
		helpers: [...helpers.values()],
		// Rolls with no session (or a session since removed) say "Between sessions".
		session: sessionName,
		type: game.i18n.localize(`LRT.RollTypes.${roll.type}`),
		power: formatNumber(roll.power ?? 0),
		outcome: {
			key: roll.outcome,
			label: game.i18n.localize(`LRT.OutcomesShort.${roll.outcome}`),
			fullLabel: game.i18n.localize(`LRT.Outcomes.${roll.outcome}`),
			icon: `${OUTCOME_ICON_PATH}/${roll.outcome}.svg`,
			fallbackIcon: OUTCOME_FALLBACK_ICONS[roll.outcome] ?? "fa-solid fa-circle",
		},
		pushed: Boolean(roll.pushed),
		dice: (roll.dice?.raw ?? []).join(" + "),
		diceTotal: roll.dice?.total,
		total: roll.total,
		tagGroups: groupTags(roll.tags, rollerId),
	};
}

/**
 * The hero who contributed this tag to someone else's roll, or null.
 * A tag owned by a different hero than the roller was contributed by them.
 * Acting Together rolls (rollerId null) have no helpers: everyone's tags are
 * in play there anyway.
 * @returns {Actor|null}
 */
function getHelper(tag, rollerId) {
	if (!rollerId) return null;
	const owner = game.actors.get(tag.ownerId);
	return owner?.type === "hero" && owner.id !== rollerId ? owner : null;
}

/**
 * Which litmv2 highlight colour a tag gets: weaknesses are orange, statuses
 * green, and every other tag yellow.
 * @returns {"tag"|"weakness"|"status"}
 */
function highlightKind(type) {
	if (type === "weakness_tag") return "weakness";
	if (type === "status_tag") return "status";
	return "tag";
}

/**
 * Sort a roll's tags into groups by type, for the expanded History row.
 * @param {object[]|object} tags  The roll's tags (old records hold only counts).
 * @param {string|null} rollerId  The hero who rolled; a hero tag owned by
 *   someone else was contributed by them (Helping Each Other). Null for
 *   Acting Together rolls, where everyone's tags are in play anyway.
 */
function groupTags(tags, rollerId) {
	if (!Array.isArray(tags)) return [];

	const groups = new Map();
	for (const tag of tags) {
		const helper = getHelper(tag, rollerId);
		// Show the tag's current name if it still exists.
		const current = foundry.utils.fromUuidSync(tag.uuid, { strict: false });

		const entry = {
			name: current?.name ?? tag.name,
			kind: highlightKind(tag.type),
			value: tag.type === "status_tag" ? tag.value : null,
			burned: tag.state === "scratched",
			hindering: tag.state === "negative",
			helper: helper && {
				img: helper.img || FALLBACK_IMAGE,
				tooltip: game.i18n.format("LRT.History.contributedBy", { name: helper.name }),
			},
		};

		if (!groups.has(tag.type)) groups.set(tag.type, []);
		groups.get(tag.type).push(entry);
	}

	return TAG_TYPE_ORDER.filter((type) => groups.has(type)).map((type) => ({
		label: `LRT.TagTypes.${type}`,
		tags: groups.get(type),
	}));
}

/** Everything the Dice tab shows, ready for the template. */
function buildDice(rolls) {
	const histogram = getDiceHistogram(rolls);
	const highest = Math.max(...histogram.map((bar) => bar.count), 1);
	const recent = getRecentAverage(rolls);
	const doubles = countDoubles(rolls);

	return {
		rollCount: game.i18n.format("LRT.Dice.histogramTitle", { count: formatNumber(rolls.length) }),
		bars: histogram.map((bar) => ({
			total: bar.total,
			count: formatNumber(bar.count),
			// Bar height as a share of the tallest bar.
			height: Math.round((bar.count / highest) * 100),
		})),
		// Big counts like "1,284" get a smaller label so they fit over the bar.
		smallLabels: formatNumber(highest).length >= 4,
		recentAverage: recent.average === null ? null : formatDecimal(recent.average),
		streak: recent.streak,
		streakLabel: recent.streak ? `LRT.Dice.${recent.streak}Streak` : null,
		progress: game.i18n.format("LRT.Dice.progress", {
			count: recent.rollsSoFar,
			needed: RECENT_ROLL_COUNT,
		}),
		doubleOnes: formatNumber(doubles.ones),
		doubleSixes: formatNumber(doubles.sixes),
	};
}

/** Write a number the way the user's language does, e.g. 1284 → "1,284". */
function formatNumber(number) {
	return number.toLocaleString(game.i18n.lang);
}

/** Write an average with one decimal place, e.g. 7.04 → "7.0". */
function formatDecimal(number) {
	if (number === null) return "–";
	return number.toLocaleString(game.i18n.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** All hero actors in the world, sorted by name. */
function getHeroes() {
	return game.actors
		.filter((actor) => actor.type === "hero")
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Decide which hero to show.
 * - Keep the current choice if that hero still exists.
 * - On first open, use the user's assigned character if it's a hero.
 * - Otherwise, show "All heroes".
 */
function pickHeroId(currentId, heroes) {
	const exists = (id) => heroes.some((hero) => hero.id === id);

	if (currentId === ALL_HEROES || exists(currentId)) return currentId;
	if (currentId === null && exists(game.user.character?.id)) return game.user.character.id;
	return ALL_HEROES;
}

/**
 * The "played by ..." line: the players who have this hero as their assigned
 * character. If nobody has it assigned, fall back to the players who own it.
 * GMs are left out, since they can own every actor.
 * @returns {string|null}  The line to show, or null if no player is found.
 */
function getPlayedBy(hero) {
	const players = game.users.filter((user) => !user.isGM);

	let names = players.filter((user) => user.character?.id === hero.id).map((user) => user.name);
	if (names.length === 0) {
		names = players.filter((user) => hero.testUserPermission(user, "OWNER")).map((user) => user.name);
	}
	if (names.length === 0) return null;

	return game.i18n.format("LRT.Window.playedBy", { names: names.join(", ") });
}

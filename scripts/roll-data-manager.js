import { buildFakeRolls, MAX_ROLLS_PER_HERO } from "./fake-data.js";
import { RollTrackerApp } from "./roll-tracker-app.js";
import {
	applyReset,
	countFakeRolls,
	getRolls,
	isTrackingPaused,
	planReset,
	saveFakeRolls,
	setTrackingPaused,
	wipeFakeRolls,
} from "./storage.js";

const MODULE_ID = "litm-roll-tracker";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * The GM-only "Manage roll data" window, opened from module settings.
 * Tabs: Reset data, Fake data (developer mode only) and Tracking.
 *
 * The window is a <form>. Pressing a submit button (Reset… or Generate)
 * "submits" it, and Foundry hands the form's values to #onSubmit, which
 * acts on whichever tab is open.
 */
export class RollDataManager extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "lrt-roll-data-manager",
		// Make the whole window a <form> element.
		tag: "form",
		// lrt--themed: our shared fonts and light/dark colors (roll-tracker.css).
		classes: ["lrt--roll-data-manager", "lrt--themed"],
		window: {
			title: "LRT.DataManager.title",
			icon: "fa-solid fa-database",
		},
		position: {
			width: 480,
			height: "auto",
		},
		form: {
			handler: RollDataManager.#onSubmit,
			// Keep the window open afterwards, so the new counts show.
			closeOnSubmit: false,
		},
		// Buttons with these data-action values call these functions.
		actions: {
			wipe: RollDataManager.#onWipe,
			toggleTracking: RollDataManager.#onToggleTracking,
		},
	};

	static PARTS = {
		tabs: {
			// Foundry's own template for a tab bar, so we don't write one.
			template: "templates/generic/tab-navigation.hbs",
		},
		reset: {
			template: `modules/${MODULE_ID}/templates/data-manager-reset.hbs`,
		},
		fake: {
			template: `modules/${MODULE_ID}/templates/data-manager-fake.hbs`,
		},
		tracking: {
			template: `modules/${MODULE_ID}/templates/data-manager-tracking.hbs`,
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "reset", label: "LRT.DataManager.tabs.reset", icon: "fa-solid fa-trash-can" },
				{ id: "fake", label: "LRT.DataManager.tabs.fake", icon: "fa-solid fa-flask" },
				{ id: "tracking", label: "LRT.DataManager.tabs.tracking", icon: "fa-solid fa-circle-pause" },
			],
			initial: "reset",
		},
	};

	/** True when the Fake data tab should be shown. */
	static get developerMode() {
		return game.settings.get(MODULE_ID, "developerMode");
	}

	/**
	 * Leave out the Fake data part when developer mode is off. Foundry calls
	 * this to decide which parts to draw.
	 */
	_configureRenderParts(options) {
		const parts = super._configureRenderParts(options);
		if (!RollDataManager.developerMode) delete parts.fake;
		return parts;
	}

	/** Leave the Fake data tab out of the tab bar when developer mode is off. */
	_prepareTabs(group) {
		const tabs = super._prepareTabs(group);
		if (group === "primary" && !RollDataManager.developerMode) delete tabs.fake;
		return tabs;
	}

	/** Gather what the templates show: heroes with their roll counts, etc. */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const rolls = getRolls();

		context.heroes = game.actors
			.filter((actor) => actor.type === "hero")
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((hero) => ({
				id: hero.id,
				name: hero.name,
				img: hero.img || "icons/svg/mystery-man.svg",
				rollCount: formatNumber(rolls.filter((roll) => roll.heroIds?.includes(hero.id)).length),
			}));

		// Rolls that belong to heroes who no longer exist (the "Deleted heroes" row).
		const deleted = planReset(new Set(), true);
		const deletedCount = deleted.deletions.length + deleted.updates.size;
		context.deletedHeroes = deletedCount > 0 ? { rollCount: formatNumber(deletedCount) } : null;

		context.maxRolls = MAX_ROLLS_PER_HERO;
		context.fakeCount = formatNumber(countFakeRolls());
		context.hasFakeRolls = countFakeRolls() > 0;
		context.paused = isTrackingPaused();
		context.tabs = this._prepareTabs("primary");
		return context;
	}

	/**
	 * The tab bar template reads `tabs`; each tab part also needs its own tab
	 * info so it can show or hide itself.
	 */
	async _preparePartContext(partId, context, options) {
		context = await super._preparePartContext(partId, context, options);
		if (partId in context.tabs) context.tab = context.tabs[partId];
		return context;
	}

	/**
	 * After drawing: make "Select all" tick or untick every reset checkbox.
	 * This is plain browser code, so it doesn't need a redraw.
	 */
	_onRender(context, options) {
		super._onRender(context, options);
		const selectAll = this.element.querySelector("[name='selectAll']");
		selectAll?.addEventListener("change", () => {
			for (const box of this.element.querySelectorAll(".lrt--dm-reset input[type='checkbox']")) {
				box.checked = selectAll.checked;
			}
		});
	}

	/**
	 * A submit button was pressed (or Enter in a field). Act on the open tab:
	 * Reset data resets, Fake data generates. `formData.object` holds the
	 * form's values by input name, e.g. { "reset.<id>": true, ... }.
	 */
	static async #onSubmit(_event, _form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		const tab = this.tabGroups.primary;
		if (tab === "reset") await this.#reset(data);
		else if (tab === "fake") await this.#generate(data);
	}

	/** Reset the ticked heroes, after a confirmation with the total. */
	async #reset(data) {
		const heroIds = new Set(tickedIds(data.reset));
		const deletedHeroes = Boolean(data.deletedHeroes);
		if (heroIds.size === 0 && !deletedHeroes) {
			ui.notifications.warn(game.i18n.localize("LRT.DataManager.reset.noneSelected"));
			return;
		}

		const plan = planReset(heroIds, deletedHeroes);
		let content = `<p>${game.i18n.format("LRT.DataManager.reset.confirm", {
			count: formatNumber(plan.deletions.length),
		})}</p>`;
		if (plan.updates.size > 0) {
			content += `<p>${game.i18n.format("LRT.DataManager.reset.confirmShared", {
				count: formatNumber(plan.updates.size),
			})}</p>`;
		}
		const confirmed = await DialogV2.confirm({ window: { title: "LRT.DataManager.reset.title" }, content });
		if (!confirmed) return;

		await applyReset(plan);
		ui.notifications.info(game.i18n.localize("LRT.DataManager.reset.done"));
		console.log(`${MODULE_ID} | Reset: ${plan.deletions.length} rolls deleted, ${plan.updates.size} shared rolls updated`);
		this.render();
		refreshTracker();
	}

	/** Generate fake rolls for the ticked heroes. */
	async #generate(data) {
		const heroIds = tickedIds(data.heroes);
		if (heroIds.length === 0) {
			ui.notifications.warn(game.i18n.localize("LRT.DataManager.fake.noHeroes"));
			return;
		}

		// Keep the number in range even if someone types past the limits.
		const count = Math.clamp(Math.round(Number(data.rollsPerHero) || 0), 1, MAX_ROLLS_PER_HERO);
		const records = buildFakeRolls(heroIds, count);
		await saveFakeRolls(records);

		ui.notifications.info(
			game.i18n.format("LRT.DataManager.fake.generated", { count: formatNumber(records.length) }),
		);
		console.log(`${MODULE_ID} | Generated ${records.length} fake rolls`);
		this.render();
		refreshTracker();
	}

	/** "Wipe fake rolls…" pressed: confirm first, then remove them. */
	static async #onWipe() {
		const count = countFakeRolls();
		const confirmed = await DialogV2.confirm({
			window: { title: "LRT.DataManager.fake.wipeTitle" },
			content: `<p>${game.i18n.format("LRT.DataManager.fake.wipeConfirm", { count: formatNumber(count) })}</p>`,
		});
		if (!confirmed) return;

		await wipeFakeRolls();
		ui.notifications.info(game.i18n.localize("LRT.DataManager.fake.wiped"));
		this.render();
		refreshTracker();
	}

	/** Pause or Resume pressed: flip the world-wide setting. */
	static async #onToggleTracking() {
		const paused = !isTrackingPaused();
		await setTrackingPaused(paused);
		ui.notifications.info(game.i18n.localize(paused ? "LRT.DataManager.tracking.pausedNotice" : "LRT.DataManager.tracking.resumedNotice"));
		console.log(`${MODULE_ID} | Tracking ${paused ? "paused" : "resumed"}`);
		this.render();
	}
}

/** The ids whose checkbox is ticked, from { <id>: true/false }. */
function tickedIds(checkboxes) {
	return Object.entries(checkboxes ?? {})
		.filter(([, ticked]) => ticked)
		.map(([id]) => id);
}

/** Redraw the Roll Tracker window if it's open, so its numbers update. */
function refreshTracker() {
	if (RollTrackerApp.instance?.rendered) RollTrackerApp.instance.render();
}

/** Write a number the way the user's language does, e.g. 1284 → "1,284". */
function formatNumber(number) {
	return number.toLocaleString(game.i18n.lang);
}

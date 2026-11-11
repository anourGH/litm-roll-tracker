// Settings: values the GM can change in Configure Settings → Module Settings.
// "world" settings belong to the whole game: only a GM can change them, and
// every connected computer can read them.

import { RollDataManager } from "./roll-data-manager.js";
import { RollTrackerApp } from "./roll-tracker-app.js";

/**
 * Register our settings. Must run during "init", before anything reads them.
 * @param {string} moduleId  Our module id; settings are stored under it.
 */
export function registerSettings(moduleId) {
	// Developer mode turns on tools only needed while building or testing the
	// module, such as the fake data generator. Off for normal games.
	// requiresReload: Foundry offers to reload after it's changed, because
	// menus are only added when the game starts (here, during "init").
	game.settings.register(moduleId, "developerMode", {
		name: "LRT.Settings.developerMode.name",
		hint: "LRT.Settings.developerMode.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
		requiresReload: true,
	});

	// A settings "menu" is a button in Module Settings that opens a window,
	// for tools too big for a single setting. `restricted: true` shows the
	// button to GMs only. Its Fake data tab only appears in developer mode.
	game.settings.registerMenu(moduleId, "manageRollData", {
		name: "LRT.DataManager.menu.name",
		label: "LRT.DataManager.menu.label",
		hint: "LRT.DataManager.menu.hint",
		icon: "fa-solid fa-database",
		type: RollDataManager,
		restricted: true,
	});

	// Whether tracking is paused. `config: false` keeps it out of the
	// settings list: it's switched from the Manage roll data window instead.
	// onChange runs on every connected computer when it changes, so the
	// "Tracking paused" banner appears or disappears for everyone at once.
	game.settings.register(moduleId, "trackingPaused", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false,
		onChange: () => {
			if (RollTrackerApp.instance?.rendered) RollTrackerApp.instance.render();
		},
	});

	// What happens to a roll made while no GM is connected. Only the GM can
	// save rolls, so with no GM online the roll can't be recorded either way;
	// this only decides whether the player is told.
	game.settings.register(moduleId, "noGmBehavior", {
		name: "LRT.Settings.noGmBehavior.name",
		hint: "LRT.Settings.noGmBehavior.hint",
		scope: "world",
		// config: true makes Foundry show this in the Module Settings menu.
		config: true,
		type: String,
		// "choices" turns the setting into a dropdown. Keys are what we store;
		// values are the (localized) labels shown in the menu.
		choices: {
			ignore: "LRT.Settings.noGmBehavior.choices.ignore",
			warn: "LRT.Settings.noGmBehavior.choices.warn",
		},
		default: "warn",
	});

	// Shows the hidden data journal in the Journal sidebar, for troubleshooting.
	game.settings.register(moduleId, "showDataJournal", {
		name: "LRT.Settings.showDataJournal.name",
		hint: "LRT.Settings.showDataJournal.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
		// When the GM flips the switch, redraw the Journal sidebar so the
		// journal appears or disappears straight away.
		onChange: () => ui.journal?.render(),
	});
}

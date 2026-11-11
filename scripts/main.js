import { registerRollCapture } from "./roll-capture.js";
import { registerSettings } from "./settings.js";
import { initStorage, registerStorage } from "./storage.js";
import { registerToolbar } from "./toolbar.js";

const MODULE_ID = "litm-roll-tracker";

// Runs early in Foundry's startup. Game data is not loaded yet;
// this is where settings are registered.
Hooks.once("init", () => {
	console.log(`${MODULE_ID} | Initializing`);

	registerSettings(MODULE_ID);
	registerStorage(MODULE_ID);

	// Start listening for litmv2 rolls.
	registerRollCapture(MODULE_ID);

	// Add the Roll Tracker button to the left toolbar.
	registerToolbar();
});

// Runs once everything is loaded and game data is available.
Hooks.once("ready", async () => {
	// Listen for rolls sent to the GM, and make sure the data journal exists.
	await initStorage();

	console.log(`${MODULE_ID} | Ready`);
});

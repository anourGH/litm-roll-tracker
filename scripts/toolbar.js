import { RollTrackerApp } from "./roll-tracker-app.js";
import { SessionControls } from "./session-controls.js";

/**
 * Adds our buttons to the scene controls (the left toolbar): "Roll Tracker"
 * for everyone, and "Session Controls" for GMs.
 *
 * Foundry builds the toolbar fresh each time it's drawn, and fires the
 * "getSceneControlButtons" hook first so modules can add their own tools.
 * `controls` is an object of control groups (tokens, notes, ...), and each
 * group has a `tools` object. We add our tool to the Token group, which is
 * the one selected by default, so the button is easy to find.
 */
export function registerToolbar() {
	Hooks.on("getSceneControlButtons", (controls) => {
		const group = controls.tokens;
		if (!group) return;

		group.tools["lrt-roll-tracker"] = {
			name: "lrt-roll-tracker",
			// A lang key: Foundry translates it for us.
			title: "LRT.Controls.openTracker",
			icon: "fa-solid fa-dice",
			// Put it after the tools already in the group.
			order: Object.keys(group.tools).length,
			// `button: true` makes it a one-click button rather than a tool you
			// switch into (like the select or ruler tools).
			button: true,
			// Everyone gets the button: GMs and players both view the stats.
			visible: true,
			onChange: () => RollTrackerApp.open(),
		};

		// Session Controls: start and end game sessions. GMs only: `visible`
		// hides the button for players.
		group.tools["lrt-session-controls"] = {
			name: "lrt-session-controls",
			title: "LRT.Controls.openSessions",
			icon: "fa-solid fa-hourglass-half",
			order: Object.keys(group.tools).length,
			button: true,
			visible: game.user.isGM,
			onChange: () => SessionControls.open(),
		};
	});
}

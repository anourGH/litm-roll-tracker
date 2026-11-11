import { RollTrackerApp } from "./roll-tracker-app.js";
import { endSession, getLiveSession, getNextSessionNumber, getRolls, getSessions, startSession } from "./storage.js";

const MODULE_ID = "litm-roll-tracker";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * The GM-only Session Controls window: shows whether a session is live and
 * lets the GM start or end one. Opened from its own toolbar button.
 */
export class SessionControls extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "lrt-session-controls",
		// lrt--themed: our shared fonts and light/dark colors (roll-tracker.css).
		classes: ["lrt--session-controls", "lrt--themed"],
		window: {
			title: "LRT.Sessions.title",
			icon: "fa-solid fa-hourglass-half",
		},
		position: {
			width: 340,
			height: "auto",
		},
		// Buttons with data-action="start" / "end" call these.
		actions: {
			start: SessionControls.#onStart,
			end: SessionControls.#onEnd,
		},
	};

	static PARTS = {
		main: {
			template: `modules/${MODULE_ID}/templates/session-controls.hbs`,
		},
	};

	/** Open the window, or bring it to the front and refresh it. */
	static open() {
		this.instance ??= new this();
		this.instance.render({ force: true });
	}

	/** What the template shows: the live session, or the last one. */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const live = getLiveSession();

		if (live) {
			const count = getRolls().filter((roll) => roll.sessionId === live.id).length;
			context.live = {
				title: game.i18n.format("LRT.Sessions.inProgress", { name: live.name }),
				rolls: game.i18n.format(count === 1 ? "LRT.Sessions.rollsRecordedOne" : "LRT.Sessions.rollsRecorded", {
					count: count.toLocaleString(game.i18n.lang),
				}),
			};
		} else {
			// getSessions() is newest first, so the first one is the last played.
			const last = getSessions()[0];
			context.lastSession = last
				? game.i18n.format("LRT.Sessions.lastSession", { name: last.name })
				: game.i18n.localize("LRT.Sessions.noSessionsYet");
		}
		return context;
	}

	/**
	 * Start pressed: ask for a name, then start the session.
	 * DialogV2.prompt shows a small dialog with one button. When it's pressed,
	 * `callback` reads the name field and that value is returned; closing the
	 * dialog instead returns null. The field is empty with the default name as
	 * faded "placeholder" text; leaving it empty uses that default.
	 */
	static async #onStart() {
		const defaultName = game.i18n.format("LRT.Sessions.defaultName", { number: getNextSessionNumber() });
		const name = await DialogV2.prompt({
			window: { title: "LRT.Sessions.startTitle" },
			content: `
				<div class="form-group">
					<label for="lrt-session-name">${game.i18n.localize("LRT.Sessions.nameLabel")}</label>
					<input id="lrt-session-name" type="text" name="name" placeholder="${foundry.utils.escapeHTML(defaultName)}" autofocus>
				</div>`,
			ok: {
				label: "LRT.Sessions.start",
				icon: "fa-solid fa-play",
				// `button.form` is the dialog's form; read the typed name from it.
				callback: (_event, button) => button.form.elements.name.value,
			},
			// Closing the dialog returns null instead of throwing an error.
			rejectClose: false,
		});
		if (name === null || name === undefined) return;

		await startSession(name);
		this.render();
		refreshTracker();
	}

	/** End pressed: confirm (naming the session and its rolls), then end it. */
	static async #onEnd() {
		const live = getLiveSession();
		if (!live) return;

		const count = getRolls().filter((roll) => roll.sessionId === live.id).length;
		const confirmed = await DialogV2.confirm({
			window: { title: "LRT.Sessions.endTitle" },
			content: `<p>${game.i18n.format("LRT.Sessions.endConfirm", {
				name: foundry.utils.escapeHTML(live.name),
				count: count.toLocaleString(game.i18n.lang),
			})}</p>`,
		});
		if (!confirmed) return;

		await endSession();
		this.render();
		refreshTracker();
	}
}

/** Redraw the Roll Tracker if it's open, so its range dropdown updates. */
function refreshTracker() {
	if (RollTrackerApp.instance?.rendered) RollTrackerApp.instance.render();
}

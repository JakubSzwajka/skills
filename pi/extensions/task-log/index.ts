import { resolve } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	isToolCallEventType,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { openTaskPicker } from "./picker.ts";
import {
	appendEntry,
	createTask,
	isTaskPath,
	listTasks,
	LOG_TYPES,
	readTask,
	renderEntry,
	renderTask,
	sessionTag,
	setStatus,
	type Task,
} from "./store.ts";

const ATTACH_ENTRY = "task-log:attachment";
const MESSAGE_TYPE = "task-log";
const STATUS_KEY = "task-log";
const MAX_INJECT_CHARS = 24_000;
const MAX_READ_ENTRIES = 200;

interface Attachment {
	path: string;
	id: string;
	title: string;
}

export default function (pi: ExtensionAPI) {
	let attached: Attachment | undefined;
	let showDone = false;

	const showStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, attached ? `task: ${attached.title}` : undefined);
	};

	const requireTask = (): Task => {
		if (!attached) {
			throw new Error("No task is attached to this session. Ask the user to run /task to attach or create one.");
		}
		const task = readTask(attached.path);
		if (!task) throw new Error(`Task file disappeared: ${attached.path}`);
		return task;
	};

	const attach = (task: Task, ctx: ExtensionCommandContext) => {
		const previous = attached && attached.path !== task.path ? attached.title : undefined;
		attached = { path: task.path, id: task.id, title: task.title };
		pi.appendEntry<Attachment | { path: null }>(ATTACH_ENTRY, attached);
		showStatus(ctx);

		const tag = sessionTag(ctx.sessionManager.getSessionId());
		const { text } = renderTask(task, MAX_INJECT_CHARS);
		const content = [
			previous ? `Switching away from "${previous}". Ignore it from now on.` : "",
			`We are working on a saved task. Its log carries over between sessions, and this session writes entries tagged s:${tag}.`,
			"",
			text,
			"",
			"Keep the log useful for whoever picks this task up next:",
			`- Call task_log when a decision is made, a commit lands, a constraint or gotcha turns up, something blocks progress, or the next step is agreed. Types: ${LOG_TYPES.join(", ")}.`,
			"- Write entries that stand alone. Name files, commit hashes, and reasons, not \"as discussed above\".",
			"- Do not log routine chatter or narration of what you are about to do.",
			"- The task file is append only. Use task_log, never edit or write on it.",
		]
			.filter((line, index) => index > 0 || line !== "")
			.join("\n");

		pi.sendMessage({ customType: MESSAGE_TYPE, content, display: true }, { deliverAs: "nextTurn" });
		ctx.ui.notify(`Attached task: ${task.title} (${task.entries.length} log entries)`, "info");
	};

	const detach = (ctx: ExtensionCommandContext) => {
		if (!attached) {
			ctx.ui.notify("No task attached.", "warning");
			return;
		}
		const title = attached.title;
		attached = undefined;
		pi.appendEntry<{ path: null }>(ATTACH_ENTRY, { path: null });
		showStatus(ctx);
		pi.sendMessage(
			{
				customType: MESSAGE_TYPE,
				content: `Task "${title}" was detached. Stop logging to it; task_log is unavailable until another task is attached.`,
				display: true,
			},
			{ deliverAs: "nextTurn" },
		);
		ctx.ui.notify(`Detached task: ${title}`, "info");
	};

	const newTask = async (ctx: ExtensionCommandContext): Promise<Task | undefined> => {
		const title = (await ctx.ui.input("Task title", "Rework auth to short-lived JWT"))?.trim();
		if (!title) return undefined;
		const description = (await ctx.ui.input("One line description (optional)", ""))?.trim() ?? "";
		return createTask(ctx.cwd, title, description);
	};

	pi.registerCommand("task", {
		description: "Task log: attach, create, finish (one screen, no arguments)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/task needs the interactive TUI.", "error");
				return;
			}

			for (;;) {
				const tasks = listTasks(ctx.cwd).filter((task) => showDone || task.status === "active");
				const action = await openTaskPicker(ctx, { tasks, attachedPath: attached?.path, showDone });

				switch (action.kind) {
					case "close":
						return;
					case "toggleDone":
						showDone = !showDone;
						continue;
					case "attach":
						attach(action.task, ctx);
						return;
					case "detach":
						detach(ctx);
						return;
					case "new": {
						const task = await newTask(ctx);
						if (!task) continue;
						attach(task, ctx);
						return;
					}
					case "done": {
						const confirmed = await ctx.ui.confirm("Mark this task done?", action.task.title);
						if (!confirmed) continue;
						setStatus(action.task.path, "done");
						ctx.ui.notify(`Marked done: ${action.task.title}`, "info");
						if (attached?.path === action.task.path) {
							detach(ctx);
							return;
						}
						continue;
					}
				}
			}
		},
	});

	pi.registerTool({
		name: "task_log",
		label: "Task Log",
		description:
			"Append an entry to the attached task's shared log. The log is append only and is read by future sessions working on the same task, so each entry must make sense on its own.",
		promptSnippet: "Append a decision, commit, constraint, blocker, or next step to the attached task log",
		promptGuidelines: [
			"Use task_log right after a decision is made, a commit lands, a constraint turns up, work gets blocked, or the next step is agreed. Do not use task_log to narrate routine steps.",
			"Task files under .pi/tasks are append only. Use task_log instead of edit or write on them.",
		],
		parameters: Type.Object({
			type: StringEnum(LOG_TYPES),
			text: Type.String({
				description: "The entry body. Self contained. Name files, commit hashes, and the reason behind a choice.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = requireTask();
			const text = params.text.trim();
			if (!text) throw new Error("Entry text is empty.");

			appendEntry(task.path, {
				type: params.type,
				text,
				session: sessionTag(ctx.sessionManager.getSessionId()),
			});

			return {
				content: [{ type: "text", text: `Logged ${params.type} to ${task.title} (entry ${task.entries.length + 1}).` }],
				details: { path: task.path, type: params.type },
			};
		},
	});

	pi.registerTool({
		name: "task_read",
		label: "Task Read",
		description:
			"Read the attached task: title, description, references, and log entries. Use it when the injected log was truncated or you need older entries.",
		promptSnippet: "Read the attached task file and its full log",
		parameters: Type.Object({
			limit: Type.Optional(
				Type.Number({ description: "Return only the newest N log entries. Omit for the whole log." }),
			),
		}),
		async execute(_toolCallId, params) {
			const task = requireTask();
			const limit = Math.min(params.limit ?? MAX_READ_ENTRIES, MAX_READ_ENTRIES);
			const entries = task.entries.slice(-limit);
			const header = `# ${task.title}\nid: ${task.id} · status: ${task.status} · file: ${task.path}\n${task.description}\n\n## Log (showing ${entries.length} of ${task.entries.length})\n`;

			return {
				content: [{ type: "text", text: `${header}\n${entries.map(renderEntry).join("\n\n") || "_Log is empty._"}` }],
				details: { path: task.path, shown: entries.length, total: task.entries.length },
			};
		},
	});

	// Task files are append only. Keep the built-in mutation tools out of them.
	pi.on("tool_call", (event, ctx) => {
		const path = isToolCallEventType("write", event)
			? event.input.path
			: isToolCallEventType("edit", event)
				? event.input.path
				: undefined;
		if (!path) return;

		if (isTaskPath(ctx.cwd, resolve(ctx.cwd, path))) {
			return {
				block: true,
				reason:
					"Task files are append only. Use task_log to add an entry. Title, status, and description are changed by the user through /task.",
			};
		}
	});

	// Rebind the attachment after /resume, /fork, or a reload. No re-injection: the
	// attach message is already part of the restored conversation.
	pi.on("session_start", (_event, ctx) => {
		attached = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== ATTACH_ENTRY) continue;
			const data = entry.data as Attachment | { path: null } | undefined;
			attached = data && data.path ? (data as Attachment) : undefined;
		}
		if (attached && !readTask(attached.path)) attached = undefined;
		showStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		attached = undefined;
		showStatus(ctx);
	});
}

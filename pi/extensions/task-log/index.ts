import { resolve } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	isToolCallEventType,
	type ContextEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_READ_CHARS,
	DEFAULT_READ_COUNT,
	MAX_READ_CHARS,
	MAX_READ_COUNT,
	TASK_CONTEXT_CHARS,
	readTaskPage,
	renderCompactTaskContext,
} from "./history.ts";
import { TaskDurabilityUncertainError } from "./locking.ts";
import { openTaskPicker, sanitizeTaskDisplay } from "./picker.ts";
import { TaskService, type TaskAttachment, type TaskContinuation } from "./service.ts";
import {
	isTaskPath,
	LOG_TYPES,
	sessionTag,
	TASK_STATUSES,
	type Handoff,
	type Task,
	type TaskStatus,
} from "./store.ts";

const ATTACH_ENTRY = "task-log:attachment";
const MESSAGE_TYPE = "task-log:context";
const LEGACY_MESSAGE_TYPE = "task-log";
const STATUS_KEY = "task-log";
const TASK_TOOLS = ["task_manage", "task_log", "task_read"] as const;

export default function (pi: ExtensionAPI) {
	let service: TaskService | undefined;
	let serviceCwd: string | undefined;
	let showInactive = false;
	let lastManagementFingerprint: { path: string; fingerprint: string } | undefined;
	const isSubagentChild = process.env.PI_SUBAGENT_CHILD === "1";
	const taskManagementEnabled = !isSubagentChild;

	const tasks = (cwd: string): TaskService => {
		if (!service || serviceCwd !== cwd) {
			const attachment = service?.getAttachment();
			service = new TaskService(cwd);
			serviceCwd = cwd;
			if (attachment) service.restore(attachment);
		}
		return service;
	};

	const syncTaskTools = () => {
		const attached = Boolean(service?.getAttachment());
		const active = pi.getActiveTools().filter((name) => !TASK_TOOLS.includes(name as typeof TASK_TOOLS[number]));
		if (taskManagementEnabled) {
			active.push("task_manage");
			if (attached) active.push("task_log", "task_read");
		}
		pi.setActiveTools([...new Set(active)]);
	};

	const showStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const attached = tasks(ctx.cwd).getAttachment();
		ctx.ui.setStatus(STATUS_KEY, attached ? `task: ${sanitizeTaskDisplay(attached.title)}` : undefined);
	};

	const persistAttachment = (attachment: TaskAttachment, ctx: ExtensionContext) => {
		pi.appendEntry<TaskAttachment>(ATTACH_ENTRY, attachment);
		showStatus(ctx);
		syncTaskTools();
	};

	const attachTask = (task: Task, ctx: ExtensionContext) => {
		const attachment = tasks(ctx.cwd).attach(task);
		persistAttachment(attachment, ctx);
		if (ctx.hasUI) ctx.ui.notify(`Attached task: ${sanitizeTaskDisplay(task.title)} (${task.entries.length} log entries)`, "info");
		return attachment;
	};

	const detachTask = (ctx: ExtensionContext, notify = true) => {
		const previous = tasks(ctx.cwd).detach();
		lastManagementFingerprint = undefined;
		if (!previous) {
			if (notify && ctx.hasUI) ctx.ui.notify("No task attached.", "warning");
			return undefined;
		}
		pi.appendEntry<{ taskId: null }>(ATTACH_ENTRY, { taskId: null });
		showStatus(ctx);
		syncTaskTools();
		if (notify && ctx.hasUI) ctx.ui.notify(`Detached task: ${sanitizeTaskDisplay(previous.title)}`, "info");
		return previous;
	};

	const persistContinuation = (continuation: TaskContinuation, ctx: ExtensionContext) => {
		if (continuation.source !== "attached") persistAttachment(continuation.attachment, ctx);
		else {
			showStatus(ctx);
			syncTaskTools();
		}
		return continuation;
	};

	const persistInvalidatedAttachment = (previous: TaskAttachment | undefined, domain: TaskService, ctx: ExtensionContext) => {
		if (!previous || domain.getAttachment()) return;
		pi.appendEntry<{ taskId: null }>(ATTACH_ENTRY, { taskId: null });
		showStatus(ctx);
		syncTaskTools();
	};

	const newTask = async (ctx: ExtensionCommandContext): Promise<Task | undefined> => {
		const title = (await ctx.ui.input("Task title", "Rework auth to short-lived JWT"))?.trim();
		if (!title) return undefined;
		const description = (await ctx.ui.input("One line description (optional)", ""))?.trim() ?? "";
		return tasks(ctx.cwd).create(title, description);
	};

	const mutationError = (action: string, error: unknown): string => error instanceof TaskDurabilityUncertainError
		? error.message
		: `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`;

	const changeStatus = async (task: Task, ctx: ExtensionCommandContext, requested?: string): Promise<void> => {
		const choice = requested?.trim() || await ctx.ui.select("Task status", [...TASK_STATUSES]);
		if (!choice) return;
		if (!(TASK_STATUSES as readonly string[]).includes(choice)) {
			ctx.ui.notify(`Unknown task status: ${choice}`, "error");
			return;
		}
		const status = choice as TaskStatus;
		if (status === "done" && !(await ctx.ui.confirm("Mark this task done?", task.title))) return;
		try {
			tasks(ctx.cwd).changeStatus(task.path, status);
			ctx.ui.notify(`Marked ${status}: ${sanitizeTaskDisplay(task.title)}`, "info");
			if (status === "done" && tasks(ctx.cwd).getAttachment()?.taskId === task.id) detachTask(ctx);
		} catch (error) {
			ctx.ui.notify(mutationError("change task status", error), "error");
		}
	};

	const manageReferences = async (task: Task, ctx: ExtensionCommandContext): Promise<void> => {
		const current = tasks(ctx.cwd).get(task.path);
		const labels = current.refs.map((ref, index) => `${index + 1}. ${sanitizeTaskDisplay(ref)}`);
		const choice = await ctx.ui.select("Task references", ["Add reference", ...labels]);
		if (!choice) return;
		try {
			if (choice === "Add reference") {
				const reference = await ctx.ui.input("Reference", "path, URL, ticket, or evidence");
				if (!reference?.trim()) return;
				tasks(ctx.cwd).addReference(task.path, reference);
				ctx.ui.notify(`Added reference to: ${sanitizeTaskDisplay(task.title)}`, "info");
				return;
			}
			const index = labels.indexOf(choice);
			if (index === -1) throw new Error("Selected reference no longer exists.");
			const action = await ctx.ui.select("Reference action", ["Edit", "Remove"]);
			if (action === "Edit") {
				const reference = await ctx.ui.input("Reference", current.refs[index]);
				if (!reference?.trim()) return;
				tasks(ctx.cwd).editReference(task.path, index, reference);
				ctx.ui.notify(`Updated reference on: ${sanitizeTaskDisplay(task.title)}`, "info");
			} else if (action === "Remove") {
				if (!(await ctx.ui.confirm("Remove this reference?", current.refs[index]))) return;
				tasks(ctx.cwd).removeReference(task.path, index);
				ctx.ui.notify(`Removed reference from: ${sanitizeTaskDisplay(task.title)}`, "info");
			}
		} catch (error) {
			ctx.ui.notify(mutationError("change task references", error), "error");
		}
	};

	pi.registerCommand("task", {
		description: "Task log: attach, create, lifecycle, and references",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/task needs the interactive TUI.", "error");
				return;
			}
			for (;;) {
				const domain = tasks(ctx.cwd);
				const action = await openTaskPicker(ctx, {
					tasks: domain.list({ includeInactive: showInactive }),
					attachedPath: domain.getAttachment()?.pathHint,
					showInactive,
				});
				switch (action.kind) {
					case "close": return;
					case "toggleInactive": showInactive = !showInactive; continue;
					case "attach": attachTask(action.task, ctx); return;
					case "detach": detachTask(ctx); return;
					case "new": {
						const task = await newTask(ctx);
						if (!task) continue;
						attachTask(task, ctx);
						return;
					}
					case "done": {
						if (!(await ctx.ui.confirm("Mark this task done?", action.task.title))) continue;
						domain.changeStatus(action.task.path, "done");
						ctx.ui.notify(`Marked done: ${sanitizeTaskDisplay(action.task.title)}`, "info");
						if (domain.getAttachment()?.taskId === action.task.id) { detachTask(ctx); return; }
						continue;
					}
					case "status": await changeStatus(action.task, ctx); continue;
					case "references": await manageReferences(action.task, ctx); continue;
				}
			}
		},
	});

	pi.registerCommand("task:continue", {
		description: "Continue the current or best active repository task",
		handler: async (_args, ctx) => {
			const domain = tasks(ctx.cwd);
			const previous = domain.getAttachment();
			const continuation = domain.continueTask();
			if (!continuation) {
				persistInvalidatedAttachment(previous, domain, ctx);
				ctx.ui.notify("No active repository task is available.", "warning");
				return;
			}
			persistContinuation(continuation, ctx);
			ctx.ui.notify(`Continuing task: ${sanitizeTaskDisplay(continuation.task.title)}`, "info");
		},
	});

	pi.registerCommand("task:attach", {
		description: "Attach a task by ID",
		handler: async (args, ctx) => {
			const taskId = args.trim();
			if (!taskId) { ctx.ui.notify("Usage: /task:attach <task-id>", "error"); return; }
			try { attachTask(tasks(ctx.cwd).getById(taskId), ctx); }
			catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
		},
	});

	pi.registerCommand("task:status", {
		description: "Set the attached task status: active, waiting, paused, or done",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/task:status needs the interactive TUI.", "error"); return; }
			try { await changeStatus(tasks(ctx.cwd).requireAttached(), ctx, args); }
			catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
		},
	});

	pi.registerCommand("task:references", {
		description: "Add, edit, or remove references on the attached task",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/task:references needs the interactive TUI.", "error"); return; }
			try { await manageReferences(tasks(ctx.cwd).requireAttached(), ctx); }
			catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
		},
	});

	pi.registerCommand("task:new", {
		description: "Create and attach a task",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/task:new needs the interactive TUI.", "error"); return; }
			const task = await newTask(ctx);
			if (task) attachTask(task, ctx);
		},
	});

	pi.registerCommand("task:detach", {
		description: "Detach the current task",
		handler: async (_args, ctx) => { detachTask(ctx); },
	});

	pi.registerTool({
		name: "task_manage",
		label: "Task Manage",
		description: "List, continue, create, attach, detach, update status, or edit references for repository tasks.",
		promptSnippet: "Reuse a task only when it covers the current request; otherwise create separate substantial work",
		promptGuidelines: [
			"Before substantial work, list active tasks. Attach one only when it covers the current request; otherwise create a task for separate work.",
			"After producing a durable artifact, add it as a reference and append a concise structured handoff. Do not copy the artifact body into the task log.",
		],
		parameters: Type.Object({
			action: StringEnum(["list", "continue", "create", "attach", "detach", "status", "reference"] as const),
			taskId: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			request: Type.Optional(Type.String({ minLength: 1 })),
			separate: Type.Optional(Type.Boolean()),
			includeInactive: Type.Optional(Type.Boolean()),
			status: Type.Optional(StringEnum(TASK_STATUSES)),
			referenceAction: Type.Optional(StringEnum(["add", "edit", "remove"] as const)),
			reference: Type.Optional(Type.String()),
			referenceIndex: Type.Optional(Type.Integer({ minimum: 0 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!taskManagementEnabled) throw new Error("Task management is disabled in subagent children.");
			const domain = tasks(ctx.cwd);
			if (params.action === "list") {
				const listed = domain.list({ includeInactive: params.includeInactive ?? true }).map((task) => ({
					id: sanitizeTaskDisplay(task.id), title: sanitizeTaskDisplay(task.title), status: task.status, entries: task.entries.length, attached: domain.getAttachment()?.taskId === task.id,
				}));
				return { content: [{ type: "text", text: JSON.stringify(listed, null, 2) }], details: { tasks: listed } };
			}
			if (params.action === "detach") {
				const previous = detachTask(ctx, false);
				return { content: [{ type: "text", text: previous ? `Detached ${sanitizeTaskDisplay(previous.title)}.` : "No task was attached." }], details: { detached: previous?.taskId } };
			}

			let task: Task;
			let source: string = params.action;
			if (params.action === "continue") {
				const previous = domain.getAttachment();
				if (!domain.getAttachment() && !params.separate && !params.request?.trim()) {
					return { content: [{ type: "text", text: "List active tasks and attach one only if it covers the current request; otherwise create a separate task." }], details: { attached: false, needsRelevanceDecision: true } };
				}
				const continuation = domain.continueTask({ separate: params.separate, title: params.title, description: params.description, request: params.request });
				if (!continuation) {
					persistInvalidatedAttachment(previous, domain, ctx);
					const attached = Boolean(domain.getAttachment());
					return { content: [{ type: "text", text: attached
						? "The attached active task does not cover this request. Create a separate task only if the request is substantial work."
						: "No relevant active repository task is available. Create one only if this request is substantial separate work." }], details: { attached } };
				}
				persistContinuation(continuation, ctx);
				task = continuation.task;
				source = continuation.source;
			} else if (params.action === "create") {
				if (!params.title?.trim()) throw new Error("A title is required to create a task.");
				task = domain.create(params.title, params.description ?? "");
				attachTask(task, ctx);
			} else {
				const taskId = params.taskId ?? domain.getAttachment()?.taskId;
				if (!taskId) throw new Error("A taskId is required when no task is attached.");
				task = domain.getById(taskId);
				if (params.action === "attach") attachTask(task, ctx);
				else if (params.action === "status") {
					if (!params.status) throw new Error("A status is required.");
					task = domain.changeStatus(task.path, params.status);
					if (params.status === "done" && domain.getAttachment()?.taskId === task.id) detachTask(ctx, false);
				} else if (params.action === "reference") {
					if (!params.referenceAction) throw new Error("A referenceAction is required.");
					if (params.referenceAction === "add") {
						if (!params.reference) throw new Error("A reference is required.");
						task = domain.addReference(task.path, params.reference);
					} else {
						if (params.referenceIndex === undefined) throw new Error("A referenceIndex is required.");
						task = params.referenceAction === "edit"
							? domain.editReference(task.path, params.referenceIndex, params.reference ?? "")
							: domain.removeReference(task.path, params.referenceIndex);
					}
				}
			}
			const compact = renderCompactTaskContext(domain.getById(task.id));
			const unchanged = lastManagementFingerprint?.path === task.path && lastManagementFingerprint.fingerprint === compact.fingerprint;
			lastManagementFingerprint = { path: task.path, fingerprint: compact.fingerprint };
			return {
				content: [{ type: "text", text: unchanged ? `${source}: ${sanitizeTaskDisplay(task.title)} (task state unchanged).` : `${source}: ${sanitizeTaskDisplay(task.title)}\n\n${compact.text}` }],
				details: { taskId: task.id, path: task.path, source, fingerprint: compact.fingerprint, unchanged },
			};
		},
	});

	pi.registerTool({
		name: "task_log",
		label: "Task Log",
		description: "Append an ordinary or structured handoff entry to the attached task's shared append-only log.",
		promptSnippet: "Append a durable decision, commit, constraint, blocker, next step, or structured handoff",
		promptGuidelines: [
			"Use task_log after a durable change or finding, not to narrate routine steps.",
			"Files in the repository's canonical task store are append only. Use task_log instead of edit or write on them.",
		],
		parameters: Type.Object({
			type: StringEnum(LOG_TYPES),
			text: Type.Optional(Type.String({ description: "Self-contained entry body. Required except for structured handoffs." })),
			handoff: Type.Optional(Type.Object({
				currentState: Type.String(), nextAction: Type.String(), blockers: Type.Array(Type.String()),
				branchOrWorktree: Type.String(), latestCommit: Type.String(), validationState: Type.String(), references: Type.Array(Type.String()),
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const domain = tasks(ctx.cwd);
			const text = params.text?.trim() ?? "";
			let task: Task;
			if (params.type === "handoff") {
				if (!params.handoff) throw new Error("Structured handoff data is required for handoff entries.");
				task = domain.appendAttached({ type: "handoff", text, handoff: params.handoff as Handoff, session: sessionTag(ctx.sessionManager.getSessionId()) });
			} else {
				if (!text) throw new Error("Entry text is empty.");
				if (params.handoff) throw new Error("Handoff data is only valid for handoff entries.");
				task = domain.appendAttached({ type: params.type, text, session: sessionTag(ctx.sessionManager.getSessionId()) });
			}
			return { content: [{ type: "text", text: `Logged ${params.type} to ${sanitizeTaskDisplay(task.title)}.` }], details: { path: task.path, type: params.type } };
		},
	});

	pi.registerTool({
		name: "task_read",
		label: "Task Read",
		description: `Read newest-first task history with an opaque backward cursor. count is 1-${MAX_READ_COUNT}; maxChars is 1-${MAX_READ_CHARS}.`,
		promptSnippet: "Read a bounded page of attached task history, optionally filtered by type, session, or text",
		parameters: Type.Object({
			count: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_COUNT })),
			maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_CHARS })),
			cursor: Type.Optional(Type.String({ minLength: 1 })),
			type: Type.Optional(Type.String({ minLength: 1 })),
			session: Type.Optional(Type.String({ minLength: 1 })),
			text: Type.Optional(Type.String({ minLength: 1 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = tasks(ctx.cwd).requireAttached();
			const page = readTaskPage(task, {
				count: params.count ?? DEFAULT_READ_COUNT,
				maxChars: params.maxChars ?? DEFAULT_READ_CHARS,
				cursor: params.cursor,
				type: params.type,
				session: params.session,
				text: params.text,
			});
			return {
				content: [{ type: "text", text: page.text }],
				details: { path: task.path, shown: page.shown, total: page.total, totalMatches: page.totalMatches, nextCursor: page.nextCursor, characters: page.characters, truncated: page.truncated },
			};
		},
	});

	pi.on("context", (event, ctx) => {
		let task: Task;
		try { task = tasks(ctx.cwd).requireAttached(); }
		catch {
			tasks(ctx.cwd).detach();
			syncTaskTools();
			const messages = event.messages.filter((message) => !(message.role === "custom" && (message.customType === MESSAGE_TYPE || message.customType === LEGACY_MESSAGE_TYPE)));
			return messages.length === event.messages.length ? undefined : { messages };
		}
		const markerChars = "[task-state:]\n".length + 16;
		const compact = renderCompactTaskContext(task, TASK_CONTEXT_CHARS - markerChars);
		const marker = `[task-state:${compact.fingerprint}]`;
		const matching = event.messages.find((message) => message.role === "custom" && message.customType === MESSAGE_TYPE && typeof message.content === "string" && message.content.startsWith(marker));
		const returnedByManagement = lastManagementFingerprint?.path === task.path && lastManagementFingerprint.fingerprint === compact.fingerprint;
		const messages = event.messages.filter((message) => {
			if (message.role !== "custom") return true;
			if (message.customType === LEGACY_MESSAGE_TYPE) return false;
			if (message.customType !== MESSAGE_TYPE) return true;
			return !returnedByManagement && message === matching;
		});
		if (returnedByManagement || matching) {
			return messages.length === event.messages.length ? undefined : { messages };
		}
		const message: ContextEvent["messages"][number] = {
			role: "custom",
			customType: MESSAGE_TYPE,
			content: `${marker}\n${compact.text}`,
			display: false,
			timestamp: Date.now(),
		};
		let insertion = messages.length;
		for (let index = messages.length - 1; index >= 0; index--) {
			if (messages[index].role === "user") { insertion = index; break; }
		}
		messages.splice(insertion, 0, message);
		return { messages };
	});

	pi.on("tool_call", (event, ctx) => {
		const path = isToolCallEventType("write", event) ? event.input.path : isToolCallEventType("edit", event) ? event.input.path : undefined;
		if (!path) return;
		if (isTaskPath(ctx.cwd, resolve(ctx.cwd, path))) {
			return { block: true, reason: "Task files are append only. Use task_log to add an entry; use /task for lifecycle and references." };
		}
	});

	const branchAttachment = (ctx: ExtensionContext) => {
		let attachment: TaskAttachment | { path: string; id: string; title: string } | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== ATTACH_ENTRY) continue;
			const data = entry.data;
			if (!data || typeof data !== "object" || Array.isArray(data)) {
				attachment = undefined;
				continue;
			}
			attachment = (("taskId" in data && data.taskId) || ("path" in data && data.path))
				? data as TaskAttachment | { path: string; id: string; title: string }
				: undefined;
		}
		return attachment;
	};

	const finishRestore = (ctx: ExtensionContext) => {
		showStatus(ctx);
		syncTaskTools();
	};

	const restoreAttachment = (ctx: ExtensionContext) => {
		const domain = tasks(ctx.cwd);
		try { domain.restore(branchAttachment(ctx)); }
		catch { domain.detach(); }
		finishRestore(ctx);
	};

	const restoreSessionAttachment = (ctx: ExtensionContext) => {
		if (!isSubagentChild) {
			restoreAttachment(ctx);
			return;
		}
		const domain = tasks(ctx.cwd);
		const persisted = branchAttachment(ctx);
		domain.detach();
		if (persisted) pi.appendEntry<{ taskId: null }>(ATTACH_ENTRY, { taskId: null });
		finishRestore(ctx);
	};

	pi.on("session_start", (_event, ctx) => { restoreSessionAttachment(ctx); });
	pi.on("session_tree", (_event, ctx) => { restoreSessionAttachment(ctx); });
	pi.on("session_shutdown", (_event, ctx) => {
		tasks(ctx.cwd).detach();
		showStatus(ctx);
		syncTaskTools();
	});
}

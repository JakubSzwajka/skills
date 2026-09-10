import { basename } from "node:path";
import { resolveRepository } from "./repository.ts";
import { findTaskById } from "./storage.ts";
import {
	appendEntry,
	createTask,
	listTasks,
	mutateReferences,
	readActiveTaskForContinuation,
	readTask,
	setStatus,
	lastActivity,
	type NewLogEntry,
	type Task,
	type TaskStatus,
} from "./store.ts";

export interface TaskAttachment {
	repositoryId: string;
	taskId: string;
	pathHint?: string;
	title: string;
}

export interface LegacyTaskAttachment {
	path: string;
	id: string;
	title: string;
}

export interface TaskContinuation {
	task: Task;
	attachment: TaskAttachment;
	source: "attached" | "selected" | "created";
}

function relevanceWords(value: string): Set<string> {
	return new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [])
		.filter((word) => !new Set(["and", "for", "from", "into", "the", "this", "that", "with", "work", "task"]).has(word)));
}

function coversRequest(task: Task, request: string): boolean {
	const requested = relevanceWords(request);
	if (requested.size === 0) return false;
	const latestHandoff = [...task.entries].reverse().find((entry) => entry.type === "handoff" && entry.handoff)?.handoff;
	const taskWords = relevanceWords([
		task.title,
		task.description,
		...task.refs,
		latestHandoff?.currentState ?? "",
		latestHandoff?.nextAction ?? "",
		...(latestHandoff?.references ?? []),
	].join("\n"));
	return [...requested].some((word) => taskWords.has(word));
}

export class TaskService {
	private attachment: TaskAttachment | undefined;
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	list(options: { includeInactive?: boolean } = {}): Task[] {
		const tasks = listTasks(this.cwd);
		return options.includeInactive ? tasks : tasks.filter((task) => task.status === "active");
	}

	create(title: string, description: string): Task {
		const normalizedTitle = title.trim();
		if (!normalizedTitle) throw new Error("Task title is empty.");
		return createTask(this.cwd, normalizedTitle, description.trim());
	}

	get(path: string): Task {
		const task = readTask(path);
		if (!task) throw new Error(`Task file is missing: ${path}`);
		return task;
	}

	getById(taskId: string): Task {
		const resolved = findTaskById(this.cwd, taskId);
		if (!resolved) throw new Error(`Task ID is missing from this repository: ${taskId}`);
		return resolved.task;
	}

	attach(task: Task): TaskAttachment {
		const current = this.getById(task.id);
		const repository = resolveRepository(this.cwd);
		this.attachment = {
			repositoryId: repository.id,
			taskId: current.id,
			pathHint: current.path,
			title: current.title,
		};
		return this.attachment;
	}

	private attachActive(task: Task): { task: Task; attachment: TaskAttachment } | undefined {
		const repository = resolveRepository(this.cwd);
		const active = readActiveTaskForContinuation(task.path);
		if (!active) return undefined;
		const attachment = {
			repositoryId: repository.id,
			taskId: active.id,
			pathHint: active.path,
			title: active.title,
		};
		this.attachment = attachment;
		return { task: active, attachment };
	}

	continueTask(options: { separate?: boolean; title?: string; description?: string; request?: string } = {}): TaskContinuation | undefined {
		if (options.separate) {
			if (!options.title?.trim()) throw new Error("A title is required for separate work.");
			const task = this.create(options.title, options.description ?? "");
			return { task, attachment: this.attach(task), source: "created" };
		}
		if (this.attachment) {
			try {
				const task = this.getById(this.attachment.taskId);
				const continued = this.attachActive(task);
				if (!continued) this.attachment = undefined;
				else {
					if (options.request?.trim() && !coversRequest(continued.task, options.request)) return undefined;
					return { ...continued, source: "attached" };
				}
			} catch {
				this.attachment = undefined;
			}
		}

		const repository = resolveRepository(this.cwd);
		const associationKeys = [repository.branch, repository.worktree, repository.root, basename(repository.worktree)]
			.map((value) => value.toLocaleLowerCase());
		const candidates = this.list()
			.filter((task) => !options.request?.trim() || coversRequest(task, options.request))
			.sort((left, right) => {
			const association = (task: Task): number => {
				const latest = [...task.entries].reverse().find((entry) => entry.type === "handoff" && entry.handoff)?.handoff;
				if (!latest) return 0;
				const value = latest.branchOrWorktree.trim().toLocaleLowerCase();
				if (!value) return 0;
				return associationKeys.includes(value) ? 2 : associationKeys.some((key) => value.includes(key) || key.includes(value)) ? 1 : 0;
			};
			return association(right) - association(left) || lastActivity(right) - lastActivity(left) || left.id.localeCompare(right.id);
		});
		for (const candidate of candidates) {
			const continued = this.attachActive(candidate);
			if (continued) return { ...continued, source: "selected" };
		}
		if (!options.request?.trim() && options.title?.trim()) {
			const task = this.create(options.title, options.description ?? "");
			return { task, attachment: this.attach(task), source: "created" };
		}
		return undefined;
	}

	restore(attachment: TaskAttachment | LegacyTaskAttachment | undefined): TaskAttachment | undefined {
		this.attachment = undefined;
		if (!attachment) return undefined;
		const repository = resolveRepository(this.cwd);
		const repositoryId = "repositoryId" in attachment ? attachment.repositoryId : repository.id;
		const taskId = "taskId" in attachment ? attachment.taskId : attachment.id;
		if (repositoryId !== repository.id) return undefined;
		const resolved = findTaskById(this.cwd, taskId);
		if (!resolved) return undefined;
		this.attachment = {
			repositoryId: repository.id,
			taskId: resolved.task.id,
			pathHint: resolved.task.path,
			title: resolved.task.title,
		};
		return this.attachment;
	}

	detach(): TaskAttachment | undefined {
		const previous = this.attachment;
		this.attachment = undefined;
		return previous;
	}

	getAttachment(): TaskAttachment | undefined {
		return this.attachment;
	}

	requireAttached(): Task {
		if (!this.attachment) {
			throw new Error("No task is attached to this session. Ask the user to run /task to attach or create one.");
		}
		return this.getById(this.attachment.taskId);
	}

	append(path: string, entry: NewLogEntry): Task {
		const task = this.get(path);
		const canonical = this.getById(task.id);
		appendEntry(canonical.path, entry);
		return this.getById(task.id);
	}

	appendAttached(entry: NewLogEntry): Task {
		return this.append(this.requireAttached().path, entry);
	}

	changeStatus(path: string, status: TaskStatus): Task {
		const task = this.get(path);
		const canonical = this.getById(task.id);
		setStatus(canonical.path, status);
		return this.getById(task.id);
	}

	private changeReferences(path: string, mutate: (refs: string[]) => string[]): Task {
		const task = this.get(path);
		const canonical = this.getById(task.id);
		mutateReferences(canonical.path, mutate);
		return this.getById(task.id);
	}

	addReference(path: string, reference: string): Task {
		const normalized = reference.trim();
		if (!normalized) throw new Error("Task reference is empty.");
		return this.changeReferences(path, (refs) => [...refs, normalized]);
	}

	editReference(path: string, index: number, reference: string): Task {
		const normalized = reference.trim();
		if (!normalized) throw new Error("Task reference is empty.");
		return this.changeReferences(path, (refs) => {
			if (!Number.isInteger(index) || index < 0 || index >= refs.length) throw new Error("Task reference does not exist.");
			refs[index] = normalized;
			return refs;
		});
	}

	removeReference(path: string, index: number): Task {
		return this.changeReferences(path, (refs) => {
			if (!Number.isInteger(index) || index < 0 || index >= refs.length) throw new Error("Task reference does not exist.");
			return refs.filter((_, candidate) => candidate !== index);
		});
	}
}

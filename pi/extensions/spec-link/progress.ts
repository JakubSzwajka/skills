import { readFileSync } from "node:fs";
import { basename } from "node:path";

/**
 * Progress is derived from what a ticket already carries, never stored.
 *
 * The acceptance boxes are the record: `- [x]` means someone confirmed that
 * criterion. The `**Blocked by:**` line is the dependency graph, written in
 * prose. Nothing here writes to a ticket, so the derivation cannot drift.
 *
 * A ticket's `**Status:**` line is ignored on purpose. `/to-tickets` used to
 * stamp one literal value into every ticket, so it could only ever lie; older
 * tickets keep the line and the parser must not treat it as authoritative.
 *
 * - `done` — every box ticked.
 * - `started` — some boxes ticked, not all.
 * - `blocked` — a ticket it depends on is not done, or cannot be found.
 * - `ready` — no boxes ticked and every dependency done.
 * - `unmeasured` — no acceptance boxes at all, so progress was never written down.
 */
export type TicketState = "done" | "started" | "blocked" | "ready" | "unmeasured";

export interface Ticket {
	path: string;
	/** The leading number in the file name, which is how tickets refer to each other. */
	number: number;
	/** That number as the operator writes it: `06`. */
	label: string;
	boxes: number;
	ticked: number;
	dependsOn: number[];
	/** Dependencies naming a ticket number this feature does not have. */
	dangling: number[];
	state: TicketState;
}

export interface Progress {
	tickets: Ticket[];
	total: number;
	done: number;
	started: number;
	blocked: number;
	ready: number;
	unmeasured: number;
}

const MAX_LISTED = 4;
const MAX_TICKET_BYTES = 64_000;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** A box counts only as the first thing in a list item: `- [x]`, `* [ ]`, `+ [X]`. */
const CHECKBOX = /^\s{0,3}[-*+]\s+\[([ xX])\]\s/;
const BLOCKED_BY = /^\s{0,3}\*\*Blocked\s+by:?\*\*:?\s*(.*)$/i;
/** A dependency is named by its leading number; the em-dashed title after it is prose. */
const LEADING_NUMBER = /^\s*[-*+]?\s*#?(\d{1,3})\b/;

/**
 * The lines a Markdown reader would treat as prose. Fenced code is skipped, so
 * a `- [x]` shown as an example is not a claim and a fenced `**Blocked by:**`
 * is not an edge. An unterminated fence swallows the rest, as Markdown does.
 */
function* proseLines(content: string): Generator<string> {
	let fence: string | undefined;
	for (const line of content.split("\n")) {
		const marker = FENCE.exec(line)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
		} else if (!fence) {
			yield line;
		}
	}
}

export function countBoxes(content: string): { boxes: number; ticked: number } {
	let boxes = 0;
	let ticked = 0;
	for (const line of proseLines(content)) {
		const box = CHECKBOX.exec(line)?.[1];
		if (!box) continue;
		boxes += 1;
		if (box !== " ") ticked += 1;
	}
	return { boxes, ticked };
}

/**
 * The numbers on the `**Blocked by:**` line. "None — can start immediately",
 * an absent line and a title with no number all mean no dependencies.
 */
export function parseDependencies(content: string): number[] {
	const found = new Set<number>();
	for (const line of proseLines(content)) {
		const rest = BLOCKED_BY.exec(line)?.[1];
		if (rest === undefined) continue;
		for (const part of rest.split(/[;,]/)) {
			const number = LEADING_NUMBER.exec(part)?.[1];
			if (number) found.add(Number(number));
		}
	}
	return [...found].sort((a, b) => a - b);
}

const readTicketFile = (path: string): string => {
	try {
		return readFileSync(path, "utf8").slice(0, MAX_TICKET_BYTES);
	} catch {
		return "";
	}
};

/** All boxes ticked, and at least one box. Local to the ticket, so cycles cannot loop. */
const isDone = (ticket: Pick<Ticket, "boxes" | "ticked">): boolean => ticket.boxes > 0 && ticket.ticked === ticket.boxes;

/**
 * Reads a feature's tickets and derives each one's state.
 *
 * `blocked` asks only whether each named dependency is done, and "done" is a
 * fact local to that dependency's own boxes. Nothing recurses, so a dependency
 * cycle terminates: every ticket on an unfinished cycle reads `blocked`.
 */
export function readTickets(files: string[]): Ticket[] {
	const parsed = files.map((path) => {
		const content = readTicketFile(path);
		const number = Number(/^(\d{1,3})-/.exec(basename(path))?.[1] ?? 0);
		return { path, number, label: String(number).padStart(2, "0"), ...countBoxes(content), dependsOn: parseDependencies(content) };
	});

	// A number is done only when every ticket carrying it is done, so a duplicated
	// number cannot let a dependency read as satisfied by its finished twin.
	const byNumber = new Map<number, Array<(typeof parsed)[number]>>();
	for (const ticket of parsed) byNumber.set(ticket.number, [...(byNumber.get(ticket.number) ?? []), ticket]);
	const doneNumbers = new Set([...byNumber].filter(([, group]) => group.every(isDone)).map(([number]) => number));

	return parsed.map((ticket) => {
		// A dependency we cannot find fails toward blocked. Reading it as satisfied
		// would quietly promote the ticket to ready on a graph nobody can trust.
		const dangling = ticket.dependsOn.filter((number) => !byNumber.has(number));
		const satisfied = ticket.dependsOn.every((number) => doneNumbers.has(number));
		let state: TicketState;
		if (isDone(ticket)) state = "done";
		else if (ticket.ticked > 0) state = "started";
		else if (!satisfied) state = "blocked";
		else state = ticket.boxes === 0 ? "unmeasured" : "ready";
		return { ...ticket, dangling, state };
	});
}

export function tally(tickets: Ticket[]): Progress {
	const count = (state: TicketState): number => tickets.filter((ticket) => ticket.state === state).length;
	return { tickets, total: tickets.length, done: count("done"), started: count("started"), blocked: count("blocked"), ready: count("ready"), unmeasured: count("unmeasured") };
}

export const readProgress = (files: string[]): Progress => tally(readTickets(files));

/** The picker's progress segment: `5/11 done, 2 blocked`. */
export function formatTally(progress: Progress): string {
	return progress.blocked > 0 ? `${progress.done}/${progress.total} done, ${progress.blocked} blocked` : `${progress.done}/${progress.total} done`;
}

/** The note's one line: the tally, the frontier, and what is waiting. */
export function formatProgressLine(progress: Progress): string {
	const sentences = [`Tickets: ${progress.done}/${progress.total} done.`];
	for (const [lead, state] of [
		["In progress", "started"],
		["Ready now", "ready"],
		["Blocked", "blocked"],
		["No acceptance boxes", "unmeasured"],
	] as Array<[string, TicketState]>) {
		const labels = progress.tickets
			.filter((ticket) => ticket.state === state)
			.map((ticket) => ticket.label)
			.sort();
		if (labels.length === 0) continue;
		// Capped so a forty-ticket feature cannot balloon the per-turn note.
		const shown = labels.slice(0, MAX_LISTED).join(", ");
		sentences.push(`${lead}: ${labels.length > MAX_LISTED ? `${shown} +${labels.length - MAX_LISTED} more` : shown}.`);
	}
	return sentences.join(" ");
}

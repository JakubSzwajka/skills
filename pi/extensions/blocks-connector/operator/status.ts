import type { PendingSnapshot, RecentSnapshot } from "../inbound/broker.ts";

export interface StatusInput {
	online: boolean;
	agentName?: string;
	instanceId?: string;
	pending: PendingSnapshot[];
	recent: RecentSnapshot[];
	recentLimit?: number;
}

export function describeStatus(input: StatusInput, now: number = Date.now()): string {
	const lines = [
		input.online
			? `Online as ${input.agentName ?? "(unknown)"}${input.instanceId ? ` (instance ${input.instanceId.slice(0, 8)})` : ""}.`
			: input.agentName
				? `Offline. Configured as ${input.agentName} — run /blocks:online to listen.`
				: "Offline. Not configured.",
	];

	if (input.pending.length === 0) lines.push("Pending inbound messages: none.");
	else {
		lines.push(`Pending inbound messages (${input.pending.length}):`);
		for (const item of input.pending) {
			lines.push(
				`• [${item.reference}] ${item.kind} from unverified peer ${item.peer} — ${remaining(item.deadlineAt - now)} remaining`,
				`  ← ${item.text}`,
			);
		}
	}

	const recent = input.recent.slice(0, input.recentLimit ?? 5);
	if (recent.length === 0) lines.push("Recent inbound activity: none.");
	else {
		lines.push(`Recent inbound activity (${recent.length}):`);
		for (const item of recent) {
			lines.push(`• ${item.kind} from ${item.peer}: ${item.state} (${formatAgo(now - item.finishedAt)})`);
		}
	}
	return lines.join("\n");
}

function remaining(deltaMs: number): string {
	const seconds = Math.max(0, Math.ceil(deltaMs / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
}

export function formatAgo(deltaMs: number): string {
	const seconds = Math.max(0, Math.round(deltaMs / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

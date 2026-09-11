import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommitCommand } from "./command.ts";

export default function commitExtension(pi: ExtensionAPI): void {
	registerCommitCommand(pi);
}

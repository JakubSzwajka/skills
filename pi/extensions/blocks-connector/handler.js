/**
 * Never actually invoked.
 *
 * `runtime.handler` is required by the Blocks CLI's card schema (it powers
 * `blocks run` / `blocks dev` for CLI-scaffolded agents), so `blocks check`
 * and `blocks register` both insist the file exist. This agent doesn't run
 * that way: `startAgentInstance` is called directly from inside the pi
 * extension process (see index.ts), with its own handler wired in from
 * net/handler.ts. If this file is ever actually invoked, something has gone
 * wrong — do not delete it, but don't expect it to do real work either.
 */
export default async function handler(_task, _ctx) {
	throw new Error(
		"handler.js should never run: this agent is started by the pi blocks-connector " +
			"extension (index.ts), not by `blocks run`.",
	);
}

# Pi Blocks connector

This global Pi extension hosts an inbound Blocks Network agent inside the current Pi
process. It reads one agent's configuration from Pi's trusted current working directory.
Nothing connects automatically: `/blocks:online` registers if needed and starts the SDK
listener; `/blocks:offline` stops it. There is no companion daemon.

## Answering model

There is one answering agent: the main Pi session. Each inbound request or pipe frame is
placed in an in-memory pending inbox and delivered as a Pi custom `followUp` message. This
avoids interrupting a coding turn already in progress. The message includes:

- an opaque reply reference;
- the unverified peer label supplied by Blocks;
- the inbound text and metadata;
- the local reply deadline.

The main agent answers with `blocks_reply({ reference, text })`. The tool immediately
resolves that exact pending item and sends exactly `text`; it has no confirmation dialog or
human-only gate. Several network tasks may be pending at once, so references are capabilities,
not list positions. `blocks_status` is read-only and shows online state, pending items, and
recent outcomes.

A human may still advise the main session, but no reply requires human approval. Inbound
network text is untrusted and enters the main coding session, so treat it like any other
untrusted prompt or file content.

## Requests, pipes, and deadlines

`request` tasks return one JSON reply artifact. `pipe` tasks use the declared bidirectional
stream and process frames serially: one inbound frame is answered before the next is read.
Across tasks, work may be concurrent up to `PI_BLOCKS_MAX_CONCURRENT` (default: the Agent
Card runtime concurrency).

Every inbound message has its own local timeout. `PI_BLOCKS_REPLY_TIMEOUT_MS` defaults to
25 minutes and is capped below the current 1800-second Blocks request hard limit. When the
SDK exposes an absolute task deadline, the connector also leaves five seconds for the final
write. A timeout, cancellation, offline transition, stream/task shutdown, or Pi session
shutdown removes the pending capability. The caller receives:

> I could not provide an answer before this task's deadline. Please try again later.

Pending replies are process-local and are never resumed after restart.

## Scope

This extension only hosts inbound `request` and `pipe` work. It does not create outbound
pipes or generic outbound tasks. Use `@blocks-network/mcp-server` for discovery and all
outbound Blocks work. There are no nested Pi sessions, puppets, briefing/precedent files,
steering queues, `/pipe` command, or outbound approval broker. `handler.js` is only the
Agent Card schema placeholder; the SDK listener receives the TypeScript handler in-process.

## Setup

Pi loads this directory through the `extensions` entry in `~/.agents/pi/settings.json`.
`~/.pi/agent/settings.json` is a symlink to that settings file. Do not add a second copy
under `~/.pi/agent/extensions`, because Pi would load the connector twice.

Create one trusted working directory per Agent:

```text
~/agents/player-a/
├── .env
├── agent-card.json
└── handler.js -> ~/.agents/pi/extensions/blocks-connector/handler.js

~/agents/player-b/
├── .env
├── agent-card.json
└── handler.js -> ~/.agents/pi/extensions/blocks-connector/handler.js
```

For each directory:

1. Copy this extension's `.env.example` into the working directory as `.env`, set
   `BLOCKS_API_KEY`, and run `chmod 600 .env`. Never commit it.
2. Copy `agent-card.example.json` into the working directory as `agent-card.json` and
   choose a globally unique `identity.agentName`. Keep `request`, `pipe`, the
   bidirectional events stream, and `runtime.handler: "handler.js"`.
3. Link the CLI-required placeholder next to the card:
   `ln -s ~/.agents/pi/extensions/blocks-connector/handler.js handler.js`. The connector
   supplies the real handler in-process, but `blocks check` and registration require this
   file to exist.
4. Start Pi from that directory and accept Pi's project trust prompt.
5. Run `/blocks:online`.
6. Use `/blocks:status` or `blocks_status` to inspect without changing lifecycle.

The connector checks process environment first, then `<current-directory>/.env`. The
Agent Card defaults to `<current-directory>/agent-card.json`. A relative `PI_BLOCKS_CARD`
path also resolves from the current directory.

Optional variables:

```text
PI_BLOCKS_CARD=agent-card.json
PI_BLOCKS_MAX_CONCURRENT=3
PI_BLOCKS_REPLY_TIMEOUT_MS=1500000
BLOCKS_CDM_URL=... # enterprise override only
```

While connected, the footer shows `🟢 blocks (<agent name>)`. The connector removes the
footer item while offline.

Registration, login, publish, deploy, and invite commands remain operator-run actions.
Tests are offline: `npm test`.

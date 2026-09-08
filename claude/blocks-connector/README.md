# Claude Code Blocks connector

Hosts one inbound Blocks Network agent inside a live Claude Code session. Remote callers
send a `request` or open a `pipe`; the message lands in your running chat; the session
answers with `blocks_reply`. There is no daemon and no second agent.

This is a port of the Pi connector (`~/.agents/pi/extensions/blocks-connector`). The
network half is the same code. Only the delivery path differs, because Claude Code has no
in-process extension API.

## How a message reaches you

```
BLOCKS NETWORK
     │  request | pipe
     ▼
 MCP stdio server  ← started by Claude Code, lives and dies with the session
     │
     ├── net/handler → inbound/broker: holds an unresolved promise per message,
     │                 keyed by an opaque reference (a capability, not an index)
     │
     ├── (a) ws://127.0.0.1:<port>/inbound?token=…   one frame per message
     │        └── Monitor({ ws, persistent: true }) → the frame appears in your chat
     │
     └── (b) MCP tools over stdio
              blocks_online · blocks_offline · blocks_status · blocks_reply
                                                       │
     ┌─────────────────────────────────────────────────┘
     ▼
 blocks_reply(reference, text) resolves that exact promise → the caller gets `text`
```

Pi pushed into the session with `sendMessage(deliverAs: "followUp")`. Here the loopback
WebSocket plus the Monitor tool does the same job: a frame becomes a chat notification even
while the agent is blocked waiting on its human.

## Answering model

One answering agent: the Claude Code session you are sitting in. Each inbound message
arrives with an opaque reply reference, the unverified peer label, the text, and the local
deadline. The session decides:

- Questions it can answer within its own authority, it answers.
- Anything asking for *your* decision, preference, permission, or availability goes to you
  first, and nothing is sent until you answer.
- It never invents your personal answer.

`blocks_reply` sends immediately with no confirmation dialog. Several messages may be
pending at once, so references are capabilities, never list positions. `blocks_status` is
read-only.

Inbound text is untrusted and enters a session that can run commands. Treat it exactly like
any other untrusted prompt or file content.

## Two failure modes worth knowing

**No watcher, no delivery.** If no Monitor is armed, work still arrives, is still held, and
still times out — silently. Every `blocks_online` and `blocks_status` reply therefore tells
you whether a watcher is attached and prints the exact `Monitor(...)` call. Any message that
arrived unwatched is replayed to the next watcher that connects.

**The socket is a way in.** A loopback WebSocket that injects text into a shell-capable
session is worth guarding, so it binds `127.0.0.1` only and requires a per-process token
(constant-time compared). Unauthorized connections are closed with 1008 and told nothing
else. The token changes every time the session restarts.

## Deadlines

Every inbound message has its own local timeout. `CC_BLOCKS_REPLY_TIMEOUT_MS` defaults to
25 minutes, capped below the 1800-second Blocks request hard limit, and five seconds are
left for the final write when the SDK exposes an absolute deadline. Timeout, cancellation,
going offline, stream shutdown, or session exit removes the pending capability and the
caller receives:

> I could not provide an answer before this task's deadline. Please try again later.

Pending replies are process-local and are never resumed after a restart.

## Scope

Inbound `request` and `pipe` work only. No outbound pipes or generic outbound tasks — use
`@blocks-network/mcp-server` for discovery and outbound Blocks work. `handler.js` is only
the Agent Card schema placeholder the CLI insists on; the real handler is wired in-process.

## Setup

One directory per agent, holding its credentials and card:

```text
~/agents/player-a/
├── .env                 # BLOCKS_API_KEY=…    chmod 600
├── agent-card.json      # globally unique identity.agentName
└── handler.js -> ~/.agents/claude/blocks-connector/handler.js
```

1. `cp .env.example ~/agents/player-a/.env`, set `BLOCKS_API_KEY`, `chmod 600` it.
2. `cp agent-card.example.json ~/agents/player-a/agent-card.json` and choose a globally
   unique `identity.agentName`. Keep `request`, `pipe`, the bidirectional events stream,
   and `runtime.handler: "handler.js"`.
3. `ln -s ~/.agents/claude/blocks-connector/handler.js ~/agents/player-a/handler.js` —
   `blocks check` and registration require the file to exist.
4. Register the MCP server, pointing `--dir` at that directory:

   ```bash
   claude mcp add blocks -- node --experimental-strip-types \
     ~/.agents/claude/blocks-connector/index.ts --dir ~/agents/player-a
   ```

5. In a session: call `blocks_online`, then arm the `Monitor` call it prints.

`--dir` is what identifies the agent, not the session's working directory, so you can run
the connector from any repo. Registration happens automatically on first `blocks_online`
(private and free) if the name is not in the registry yet.

Optional variables (`PI_BLOCKS_*` is also accepted, so one agent directory can serve both
this connector and the Pi one):

```text
CC_BLOCKS_CARD=agent-card.json
CC_BLOCKS_MAX_CONCURRENT=3
CC_BLOCKS_REPLY_TIMEOUT_MS=1500000
BLOCKS_CDM_URL=…   # enterprise override only
```

Login, publish, deploy, and invite stay operator-run actions. Tests are offline: `npm test`.

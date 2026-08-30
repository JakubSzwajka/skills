---
name: board
description: The founder's board of advisors — the standing strategy, memory and address book of their side-business portfolio. Use when the question is portfolio-level (should I build this, kill it, price it this way; why did a buyer say no; what deserves my limited hours), when it needs board memory (past decisions, where the last session left off, the founder's constraints, the legal register), or when it asks WHERE something lives (which repo, Notion page, Drive folder, analytics site). Also use when the user simply addresses "the board". Not for executing product work inside a product repo.
---

# Board

This skill is a **bookmark, not a program**. It holds no knowledge about the company —
only enough to find it. Everything about how the board works lives in the board repo and
is read live, so the board improves without this file ever changing.

## Do this

1. **Resolve `$BOARD`** — the environment variable `BOARD_HOME` if set, otherwise
   `~/DEV/priv/board`.
2. **If neither exists, stop.** Tell the user the board is not on this machine and give
   them the clone command:
   `git clone git@github.com:JakubSzwajka/autonomous-company.git ~/DEV/priv/board`
   Never answer a board question from an empty memory — a confident answer with no memory
   behind it is the failure this repo exists to prevent.
3. **Read `$BOARD/agents/BRIEF.md` and follow it.** It is the operating contract: the
   cold-start rule, the map rule, where memory and doctrine live, how to convene the
   seats, and what the board must not do. Do not substitute your own procedure for it.

That is the whole of this file. The brief takes over from step 3.

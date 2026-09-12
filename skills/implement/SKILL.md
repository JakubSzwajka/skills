---
name: implement
description: "Implement a piece of work from explicit spec or ticket requirements."
disable-model-invocation: true
---

# Implement

Implement the behavior in the user's request, central spec, or central ticket.

If work is delegated, the master must provide a self-contained brief with the needed intent, constraints, acceptance checks, and explicit spec or ticket content. A child never inherits or discovers the master's `/spec` mount and must not be told to inspect the whole central spec.

Use `/tdd` where practical, at the agreed seam. Run focused tests and type checks as the work moves, then run the broad relevant suite at the end.

Ticket boxes and blockers may guide the order of work. They never set spec status. Do not run `/spec:status` from a child or infer `done` from ticket progress.

Return implementation and verification evidence in the handoff. Name any durable approval, rejected alternative, material discovery, scope change, or verifier outcome as a log candidate. Do not treat each test run, generated file, checkbox, or routine handoff as a log event.

Once implementation is ready, use `/code-review` with a fresh read-only reviewer. Commit only when the user has explicitly approved a commit.

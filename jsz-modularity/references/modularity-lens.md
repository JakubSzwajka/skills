# Modularity Lens: Capabilities vs. Operations

## Core Concepts

### Capability
A unit that owns domain invariants — the rules, constraints, and state transitions that define what is correct in the domain.

Properties:
- Owns and enforces business rules
- May be stateful (aggregates, entities) or stateless (domain services, value object computations)
- Answers: "what is possible and correct?"
- Composable — used by multiple operations
- Self-contained — does not coordinate other capabilities

Examples across stacks:
- An aggregate that validates state transitions (`Order.confirm()`)
- A domain service that calculates pricing rules
- A value object that enforces format invariants (`Email`, `Money`)
- A pure function that applies business logic (`calculateDiscount(cart, customer)`)
- A policy object that encodes decision rules (`RefundPolicy.isEligible(order)`)

### Operation
A unit that orchestrates capabilities to fulfill a use case. It coordinates work but does not own invariants.

Properties:
- Triggered by commands, events, or external requests
- Calls capabilities to enforce rules
- Manages side effects: persistence, messaging, external calls
- Answers: "what happens when X occurs?"
- Thin — delegates domain decisions to capabilities

Examples across stacks:
- An application service that handles `PlaceOrderCommand`
- A controller/handler that coordinates validation → domain logic → persistence
- An event handler that reacts to `PaymentReceived` by calling domain services
- A saga/process manager that coordinates a multi-step workflow
- A use-case interactor in clean architecture

## Violation Catalog

### V1: Leaked Invariant (capability logic in an operation)
**What**: An operation contains business rules, validation logic, or domain decisions that should live in a capability.
**Signal**: `if/else` or `switch` in operations that encode domain rules rather than routing/coordination. Inline calculations that represent business formulas. Validation beyond input shape (e.g., checking business state).
**Severity**: HIGH when the rule could need reuse or is core domain logic. MEDIUM when the rule is simple and unlikely to be reused. LOW when it's borderline (e.g., a trivial null check).

### V2: Fat Orchestrator (operation absorbing domain knowledge)
**What**: An operation has grown to contain substantial domain logic, making it hard to test domain rules in isolation.
**Signal**: Operation is significantly longer than a simple coordinate-delegate-persist flow. Multiple domain concepts are manipulated inline. Testing requires full operation setup just to verify a business rule.
**Severity**: HIGH when multiple domain concepts are entangled. MEDIUM when one concept is inlined but could be extracted. LOW when the operation is slightly verbose but logic is simple.

### V3: Capability Doing Coordination (domain unit orchestrating side effects)
**What**: A capability reaches out to external systems, triggers persistence, sends messages, or calls other infrastructure.
**Signal**: Repository/database calls inside domain objects. HTTP/message queue calls from domain services. Event publishing mixed with invariant enforcement.
**Severity**: HIGH when infrastructure is tightly coupled to domain logic. MEDIUM when the coordination is limited (e.g., one repository call). LOW when it's a borderline case like lazy loading.

### V4: Anemic Capability (invariant-free domain object)
**What**: A domain object exists but contains no business rules — it's a data bag. Operations manipulate its fields directly instead of asking the object to enforce its own rules.
**Signal**: Getters/setters with no invariant checks. All business logic for this concept lives in operations. The object could be replaced by a plain data structure with no behavioral loss.
**Severity**: HIGH when the concept has clear invariants that should be enforced. MEDIUM when some behavior belongs here but some is legitimately external. LOW when the concept is genuinely a data transfer structure.

### V5: Boundary Blur (mixed responsibilities in a single module/file)
**What**: A single module, class, or file contains both capability logic and operation orchestration without clear separation.
**Signal**: A class that both enforces domain rules AND coordinates persistence/external calls. A file that exports both domain functions and use-case handlers. No clear layering within the module.
**Severity**: HIGH when the module is large and the concerns are distinct. MEDIUM when the module is small but could grow. LOW when it's a small utility combining trivially related concerns.

### V6: Cross-Capability Coordination (capability depending on another capability's internals)
**What**: One capability reaches into another capability's internal state or logic instead of going through an operation that coordinates them.
**Signal**: Direct imports between capability modules that bypass the operation layer. One aggregate reading another aggregate's state directly. Domain service calling into another domain service's internal helpers.
**Severity**: HIGH when it creates tight coupling between distinct domain concepts. MEDIUM when the concepts are closely related. LOW when it's a shared value object or common type.

## Severity Definitions

| Level | Meaning | Action |
|-------|---------|--------|
| HIGH | Actively harmful — creates coupling, blocks reuse, hides domain logic, or makes testing hard | Restructure now |
| MEDIUM | Code smell — works today but will cause pain as the codebase grows | Plan to restructure |
| LOW | Minor — noted for awareness, may be acceptable pragmatic trade-off | Consider restructuring |

## Analysis Heuristics

When reviewing code:
1. Identify all units (classes, modules, functions, files)
2. Classify each as capability, operation, or mixed
3. For capabilities: verify they own invariants and don't coordinate
4. For operations: verify they delegate domain decisions and stay thin
5. For mixed: flag as V5 and determine which parts belong where
6. Check cross-references: capabilities should not import other capabilities' internals (V6)
7. Check for anemic models: domain objects with no behavior (V4)

When reviewing PRDs/designs:
1. Identify described behaviors and workflows
2. Map behaviors to capability vs. operation
3. Flag any described workflow that embeds domain rules in coordination logic
4. Flag any described domain concept that has no enforced invariants
5. Suggest where boundaries should be drawn before implementation

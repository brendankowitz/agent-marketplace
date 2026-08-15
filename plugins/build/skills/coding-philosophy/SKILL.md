---
name: coding-philosophy
description: >
  Use when writing, refactoring, debugging, or reviewing code where design
  decisions affect correctness, clarity, maintainability, or complexity.
---

# Coding Philosophy

Apply these principles to the current task. Project standards in `AGENTS.md` take precedence.

## Applying the Defaults

Start with the simplest concrete design that meets current requirements. If an explicit requirement conflicts with a default, this decision note is required before implementation:

- **Required design:** The mandate.
- **Cost:** Its tradeoff.
- **Simpler design:** A concrete alternative.
- **Outcome:** Follow the requirement unless it compromises correctness.

This records a settled tradeoff; it does not reopen the requirement.

## Design Philosophy

**Indirection has a cost.** Use abstractions for present variation or genuine boundaries, not anticipated variation. An interface created only for a test double is a design warning.

**Construction owns invariants.** Existing instances should be valid. Enforce invariants in the constructor, factory, or parser that owns creation. Model constrained concepts with types and prefer immutability.

**Wrong abstraction costs more than duplication.** Extract only when the shared concept and its variation are evident.

**Defensive checks need evidence.** Validate once at the public, external, concurrent, reflective, or otherwise unverifiable boundary that owns the contract. In trusted code, prefer types and control flow over repeated guards. Model legal absence; never fabricate required data with empty fallbacks.

**Behaviour belongs with its data.** Keep rules near the values they constrain instead of creating property bags and distant services.

**Documentation adds information.** Document purpose and what signatures cannot convey: invariants, failures, lifetime, ownership, or thread-safety. Comments explain why, not what.

**The codebase outranks your preferences.** Match surrounding patterns; propose broader changes separately.

## Precedence

Resolve conflicts in this order: **correctness and invariants**, **clarity**, **consistency with surrounding code**, then **reduced duplication**. Removing duplication never justifies obscuring code.

## Checkable Defaults

These are defaults, not absolutes.

- Prefer language-appropriate immutable constructs; introduce mutability deliberately.
- Introduce interfaces for present variation or genuine boundaries such as I/O, clocks, SDKs, or independently owned components.
- State why concrete code is insufficient before adding a layer, base class, or generic parameter.
- Wrap primitives where an invariant exists.
- Enforce invariants at construction; validate trust-boundary input where its contract is owned.
- Express constraints in types; retain runtime validation at unverifiable boundaries.
- Prefer command-query separation unless the operation's semantics make a returned result meaningful.
- Prefer one major symbol per file when it matches the language and codebase.
- Test observable behaviour; exposing internals for tests is a design warning.
- Add configuration, hooks, or parameters only for present callers.
- If one behaviour requires several new types, reconsider the design.

## Common Mistakes

| Mistake | Better decision |
|---|---|
| Interface, base class, and factory for one implementation | Start concrete; extract when a real boundary or variation appears |
| Repeated guards and empty fallbacks | Validate once at the owning boundary |
| Silently following a conflicting requirement | Record the four-part decision note without reopening the requirement |

# Hunter instructions

You are hunting for vulnerabilities in source code so the owners can fix them. Read
`../references/evidence-bar.md` (relative to this file) first. It defines what counts as a finding and what you
may not do. Then read the sections of `../references/attack-classes.md` that apply: the ones the map
selects, or the ones your assignment names. With no map, read the Core section and pick the
domain sections that fit what you find.

## Inputs

- **Scope**: the target and commit. If a `diff.patch` sits beside it, start from the changed
  lines and follow each one to its callers and to the controls it depends on.
- **Map**, if given: principals, entry points, boundaries and controls. Treat it as a guide
  and re-read the code it cites before relying on it. With no map, spend your first few
  minutes working out the same things for yourself.
- **Assignment**: everything in scope, or one unit. Hunt inside it. You may read code
  outside it to settle a candidate (a caller, a helper, a guard), and you list that under
  "Examined" marked "outside assignment". A lead that starts outside it goes under "Not
  examined" for someone else.
- **Project security rules**, if the scope names a rules file: each rule states an invariant
  this codebase has broken before. Check every rule against the code in your assignment.

The level in the scope file changes how many agents run, not how you work. Severity is the
verifier's job, so you do not assign one. Cite paths relative to the target root.

## Method

Work from an invariant, not from a keyword search.

1. Pick an entry point and the least trusted actor that can reach it.
2. Follow what that actor controls through parsing, identity, authorization, normalization,
   storage and the final sink. Read the code. Do not infer behaviour from a function's name.
3. At each control, ask what it checks, against which resource, for which principal, and
   whether the code after it uses the same value it checked.
4. Read the sibling paths that reach the same effect: batch, bulk, import, export, legacy,
   retry, error, admin and background versions. The main path is usually guarded and a
   sibling often is not. Compare what the checks do, not just whether one exists.
5. Try the awkward inputs the interface accepts: absent, empty, zero, negative, huge,
   duplicate, mixed encoding, stale, revoked, reordered, concurrent.
6. Where one component hands off to another, compare what the first guarantees with what
   the second assumes.
7. Stop a line of inquiry when the invariant is settled either way, and write down which.

## Before you write a candidate

Try to disprove it. Look for a guard in middleware, in the caller, in the framework, in the
type, or in the schema. Check that the actor can really reach the entry point with the input
you need. Drop what does not survive. Returning no candidates is a valid result. Do not pad.

When a high or critical candidate has a reusable root cause, search your assignment for
other places with the same flaw, and list each with its own trace.

## Result

Write markdown to the result path you were given:

```markdown
## Candidates

### C1: <title>
- Proposed verdict: confirmed | needs_validation
- Root cause: <short stable phrase, e.g. "export handler skips tenant filter">
- Actor: <who, starting with what>
- Input or action: <what they send or do>
- Control: <what should stop it and why it does not>
- Trace:
  - `path/file.ext:123` <what happens here>
    > <quoted line>
  - `path/other.ext:45` <...>
- Boundary crossed: <whose what>
- Result: <the concrete outcome>
- Conditions: <configuration or state that must hold>
- Missing fact: <needs_validation only: the one fact source cannot settle, and a safe way
  for the owner to check it>
- Fix: <the invariant to enforce, where, and a regression test>

## Hardening notes
- <weakness with no boundary crossed> [`file:line`]

## Examined
| Surface or path | Classes checked | Outcome |
|---|---|---|
| <entry point or file> | <class sections> | clean / C1 / hardening note |

## Not examined
- <surface, path or class you did not get to, and why>
```

List something under "Examined" only if you read the code; for a file read in part, give the
line ranges. The audit's coverage statement is
built from these two sections, so an honest "Not examined" is worth more than a long
"Examined".

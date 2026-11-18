# Fix reviewer instructions

You are checking whether a proposed fix really closes a vulnerability. You did not write the
fix. Read `../references/evidence-bar.md` (relative to this file) first, for the limits on
what you may do. You are read-only and you do not run the code or its tests.

A fix that blocks the reported request but leaves the root cause in place is the most common
failure. Assume the reporter found one path of several.

## Inputs

- **Finding**: a confirmed record or advisory. It gives the actor, the trace and the
  boundary crossed.
- **Fix**: a diff, and the patched source it applies to.

## Method

1. **State the invariant** the code must hold, in one sentence, without mentioning the
   exploit. For example: "every delete executed by a background job is limited to the
   compartment of the caller who requested it."
2. **Find where the fix enforces it.** Quote the line. Is that point one every path to the
   sink passes through, or only the reported path? A check at the entry point guards one
   door. A check at the last trusted decision before the sink guards them all.
3. **Re-walk the original trace** through the patched code. Say exactly which step now
   stops it.
4. **Hunt the variants.** List every other way to reach the same sink or the same effect:
   sibling endpoints, batch, bulk, import, export, background and retry paths, other
   parameters with the same effect, other encodings or casings of the blocked input, other
   resource types, other callers of the changed function. Trace each one through the patched
   code. This step decides the verdict, so spend most of your effort here.
5. **Try to get around the check itself.** Is it a deny-list that misses a spelling? Does it
   compare a different value from the one used later? Can it be skipped by a flag,
   configuration, a null or an error path? Does it fail open?
6. **Check the tests.** For each test in the fix, would it fail if the fix were reverted?
   Does any test cover a variant, or only the reported request? Name the missing tests.
7. **Check for collateral.** Does the fix break a legitimate caller (background jobs,
   internal callers, other roles), or open something new?

## Result

Write markdown to the result path you were given:

```markdown
## Verdict: closes | partial | does not close

- Invariant: <one sentence>
- Enforced at: `file:line`
  > <quoted line>
- Original trace: stopped at <step>, because <why> | still reaches the sink

## Variants
| Path to the same effect | Where (`file:line`) | After the fix |
|---|---|---|
| <path> | <location> | blocked by <what> / still open / not examined |

## Still open
- <each remaining path, with its trace, in the hunter's candidate shape>

## Tests
| Test | Fails on revert? | Covers |
|---|---|---|

Missing: <tests that should exist>

## Collateral
<legitimate behaviour the fix changes, or "none found">

## Better fix
<only if the verdict is not "closes" or the fix is at the wrong layer: the smallest change
that enforces the invariant for every path>
```

`closes` means the original trace and every variant you found are blocked, and a test would
catch a revert. `partial` means the reported path is blocked and at least one variant is
open or untested. Anything left open goes to the owner as a new candidate.

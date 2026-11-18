# Verifier instructions

You did not write these candidates. Your job is to try to refute each one from the source.
Read `../references/evidence-bar.md` (relative to this file) first. It defines the verdicts,
severity anchors and what you may not do.

Use the exact source root and commit in the supplied scope. For validation mode, use the
advisory's requested scope and its commit-specific worktree when supplied. A map is optional
and may be absent in validation mode; do not treat its absence as a failure.
The parent supplies a globally unique ledger ID for every candidate. Use that ID verbatim
for every candidate heading and decision; retain hunter-local IDs only as references.

Assume the hunter may be wrong about anything: a line number, what a function does, whether
the path is reachable. A candidate you cannot refute after a real attempt is worth far more
than one you waved through.

A candidate may be an advisory submitted by an outside reporter instead of a hunter's block.
Then first restate its claim as the six parts in the evidence bar, finding the `file:line`
for each step yourself. Its proof of concept is a claim to check against the source, not
something to run, and the output the reporter recorded is not evidence. Its severity is the
reporter's opinion. Use the parent's globally unique ledger ID as the candidate ID, and
record the advisory's own ID as a reference.

A proof of concept can show a real mechanism without showing a boundary crossed, for example
when it ran against a server with authentication off, where the caller could already do
everything. Then look for a configuration the repository supports in which the same
mechanism does cross a boundary. Confirm on that and say so, or reject if there is none.
If the scope records which deployment shapes matter, search only those. If the mechanism
crosses a boundary only in a shape the scope excludes, reject it for the recorded scope
and name that shape in the reason.

## For each candidate

1. **Re-read every cited location.** Open each `file:line`. Confirm the quoted line is there
   and does what the trace says. A trace that does not hold is `rejected`.
2. **Check both ends.** The first step must be an entry point the named actor can really
   reach. The last must be the claimed sink or effect.
3. **Look for the control the hunter missed.** Middleware, a base class, a decorator or
   attribute, a framework default, a schema or type constraint, a database constraint, a
   caller that only passes safe values. Read the map's Controls section when a map exists,
   then check the code. Without a map, search for the controls yourself.
4. **Check the conditions.** Is the required configuration the default, or one someone has
   to choose? Say which. If the scope records deployment shapes, confirm the configuration
   is one of them. If it is not, reject it as above.
5. **Check the result is not inflated.** Hold it to what the trace establishes.
6. **Decide.**
   - `confirmed`: the trace holds, no visible control stops it, and nothing outside the
     repository decides it. Assign severity from the anchors.
   - `needs_validation`: one named fact outside source decides it. Make the owner's check
     exact and safe. If source alone refutes the claim, it is `rejected`, not this.
   - `rejected`: give the control, the impossible precondition, the missing result, or the
     excluded deployment shape.
7. **Check the fix.** It should enforce the invariant at the last trusted decision point and
   be the smallest change that does. Correct it if not, and write one if none was proposed.

You may promote a `needs_validation` to `confirmed`, or demote the other way, when the
source supports it.

## Result

Write markdown to the result path you were given, one block per candidate:

```markdown
### <ledger-id>: <title, corrected if needed>
- Original ID: <hunter-local or advisory ID>
- Decision: confirmed | needs_validation | rejected
- Severity: <confirmed only>
- Reason: <what you checked and what settled it>
- Boundary: <who> can <do what> to <whose what>
- Control: <what should have stopped it and why it does not>
- Trace: <the verified `file:line` chain, with the decisive line quoted>
- Conditions: <what must be true, and whether it is the default>
- Differs from the report: <where the claim was wider, narrower or wrong>
- Also affected: <entry points beyond the main trace that the assigned candidate named
  and that you traced in full>
- Missing fact and safe check: <needs_validation only>
- Fix: <the invariant, where to enforce it, a regression test>
- Related, not verified: <every other path with the same root cause, each with a `file:line`,
  even if you traced it in full. Return these to the parent as new candidates; they are
  not part of this decision>

## Hardening notes
- <weakness noticed along the way with no boundary crossed> [`file:line`]
```

Cite paths relative to the target root. Your record replaces the hunter's wording, so write
it to stand on its own. Preserve every candidate ID and give each exactly one decision.
Only paths named in the assigned candidate belong under "Also affected". Put every path
you discovered under "Related, not verified", even if you traced it in full. Do not drop a
path when grouping findings. If a decisive line contains a secret, redact it as
`[REDACTED: <kind>]` or omit the quote while retaining its citation and explaining why.

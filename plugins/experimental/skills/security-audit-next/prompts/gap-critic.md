# Gap critic instructions

You are checking coverage in a source-only security audit. Read
`../references/evidence-bar.md` first. Do not hunt for vulnerabilities or treat missing
agent output as evidence that an area was clean.
Use the supplied safe Git prefix for any commit reads allowed by the evidence bar.

Read the supplied scope, valid map and every valid hunt result. Compare each mapped entry
point, trust boundary, applicable attack-class section and deep-mode unit against the
hunters' "Examined" and "Not examined" sections. Identify every surface or class with no
valid examination, most dangerous first. Include partially read files and explicitly
exclude them from full coverage.

Write markdown to the exact output path assigned for this run:

```markdown
# Coverage gaps

## Uncovered mapped scope
| Surface, boundary, class or unit | Map reference | Hunter coverage | Gap |
|---|---|---|---|

## Not mapped
- <scope item omitted or not mapped, and why>

## Covered
- <mapped item with an exact hunter result and "Examined" reference>
```

Use "None" only for an empty section after checking every map entry and result. Do not infer
that a missing, stale, malformed or incomplete hunt file examined anything; report the
affected assignment as uncovered. The parent reconciles this record with all assignments
and follow-up results, and carries every unresolved item to "Not examined".

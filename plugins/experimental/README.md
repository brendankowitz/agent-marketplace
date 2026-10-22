# experimental

Staging area for in-development agents and skills. One plugin, not one per phase —
what lives here changes as work moves through it, and it is usually one or two things.

Install it alongside the stable plugins and compare directly:

```bash
copilot plugin install experimental@agent-marketplace
claude plugin install experimental@agent-marketplace
```

## Currently in flight

| Skill | Successor to | What is being tried |
|---|---|---|
| `implement-task-next` | `build:implement-task` | A compaction-proof ledger under `./agent-working/`, a mixed-family Copilot recommended default (Luna / Sonnet / Opus / Astra) with Anthropic and GPT alternatives, a Luna reader on Copilot, per-tier reasoning effort, a bounded fix loop with tier escalation, an optional scoped `mutation-coverage-next` check for .NET tests, and a status contract for implementers. |
| `multi-agent-pr-next` | — (new) | A protocol for two or more agents fixing one issue on one PR through GitHub comments alone, with a kickoff prompt per agent. Pairs with `implement-task-next`. See its SKILL.md. |
| `mutation-coverage-next` | — (new) | Stryker.NET mutation testing for "just enough" .NET tests: kill surviving mutants and identify redundant tests, with protected-test safeguards and a before/after lost-kill check. Requires the .NET SDK and PowerShell 7+. Used optionally by `implement-task-next`. See its SKILL.md for the workflow and limitations. |
| `user-acceptance-test-next` | — (new) | A recorded UAT of a pull request: read the PR and linked issues or work items, confirm the acceptance criteria with the user (or propose them from the diff), run each one for real, and assemble a chaptered MP4 with PASS/FAIL per criterion showing HTTP exchanges, emitted logs, database rows, UI changes and doc changes, plus a written report. Command and API evidence is recorded in a notebook-style "workbench" page (cells run for real, results render as request/response, log and SQL cards); Playwright records browser evidence and the workbench, VHS tapes remain an alternative, and ffmpeg assembles. Optional narration through Azure AI Speech or the OS voice, and an optional background-music bed ducked under the voice. Node helpers run on Windows, macOS and Linux. Written for Copilot CLI and Claude Code. |

## Conventions

**Skills carry a `-next` suffix** in their frontmatter `name` and directory name
(`implement-task-next`). Skills appear to surface unnamespaced, so an unsuffixed
copy would collide with its stable counterpart. The suffix is what lets both be
installed at once and invoked side by side (`/implement-task` vs
`/implement-task-next`).

**Agents do not appear to need a suffix** — they surface namespaced by plugin
(`experimental:some-agent` vs `build:some-agent`), so a name clash should be
harmless.

> Both statements above are inferred from how skills and agents appear in host
> tool listings, not from platform documentation — unlike the `model:` behaviour
> in the root README, which is backed by observed CLI wire logs.
> Confirm before relying on them. If skills turn out to be plugin-namespaced,
> the `-next` suffix is unnecessary ceremony and promotion becomes a pure move.

**The plugin version stays `0.x`.** It signals unstable and is not a meaningful
changelog; the contents turn over too fast for the number to mean anything.

**Nothing here is supported.** Contents can change or disappear without notice.

## Promotion

Promotion **replaces** the skill it supersedes; the two do not coexist outside
this staging area. When an experiment is ready:

1. `git rm -r plugins/<target>/skills/<skill>` — delete the stable skill being
   superseded. Skip only if this is a brand-new skill with no stable counterpart.
2. `git mv plugins/experimental/skills/<skill>-next plugins/<target>/skills/<skill>`
   — move and rename the directory in one step, so it lands on the name just freed.
3. Drop the `-next` suffix from the frontmatter `name`.
4. Delete the `> **Experimental.**` callout at the top of the skill. Left in
   place, the promoted skill claims to be superseded by itself.
5. Bump the target plugin's version, **and update its `description`** if the
   skill list changed, in all four manifests:
   - `plugins/<target>/plugin.json`
   - `plugins/<target>/.claude-plugin/plugin.json`
   - `.github/plugin/marketplace.json`
   - `.claude-plugin/marketplace.json`
6. Remove the skill's row from the "Currently in flight" table above.
7. Update the root `README.md` plugin table — both the target plugin's row and
   the `experimental` row, if either enumerates contents.

If an experiment is abandoned, delete it and remove its row from the table. An
entry that has sat here for more than a few weeks is either ready to promote or
ready to drop — leaving it makes this a graveyard rather than a staging area.

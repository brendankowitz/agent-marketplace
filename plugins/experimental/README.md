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
| `implement-task-next` | `build:implement-task` | A compaction-proof ledger under `./agent-working/`, model tiers split by provider (Anthropic / GPT) with per-tier reasoning effort, a bounded fix loop with tier escalation, and a status contract for implementers. |

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
> in the root README, which cites [copilot-cli#2939](https://github.com/github/copilot-cli/issues/2939).
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

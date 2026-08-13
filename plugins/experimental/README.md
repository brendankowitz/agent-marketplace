# experimental

Staging area for in-development agents and skills. One plugin, not one per phase —
what lives here changes as work moves through it, and it is usually one or two things.

Install it alongside the stable plugins and compare directly:

```bash
copilot plugin install experimental@agent-marketplace
claude plugin install experimental@agent-marketplace
```

## Conventions

**Skills carry a `-next` suffix** in their frontmatter `name` and directory name
(`implement-task-next`). Skills are not namespaced by plugin, so an unsuffixed copy
would collide with its stable counterpart. The suffix is what lets both be installed
at once and invoked side by side (`/implement-task` vs `/implement-task-next`).

**Agents do not need a suffix** — they are namespaced by plugin already
(`experimental:some-agent` vs `build:some-agent`), so a name clash is harmless.

**The plugin version stays `0.x`.** It signals unstable and is not a meaningful
changelog; the contents turn over too fast for the number to mean anything.

**Nothing here is supported.** Contents can change or disappear without notice.

## Promotion

When an experiment is ready:

1. `git mv` the skill into its target phase plugin
2. Drop the `-next` suffix from the directory and the frontmatter `name`
3. Bump the target plugin's version in all four manifests (`plugins/<name>/plugin.json`,
   `plugins/<name>/.claude-plugin/plugin.json`, `.github/plugin/marketplace.json`,
   `.claude-plugin/marketplace.json`)
4. Update the root `README.md` plugin table if the contents column changes

If an experiment is abandoned, delete it. An entry that has sat here for more than a
few weeks is either ready to promote or ready to drop — leaving it makes this a
graveyard rather than a staging area.

---
name: agent-journal
description: >
  Install, configure, and use AgentJournal to extend the agent's persistent memory and knowledge retrieval.
  Use when setting up a new environment, searching past sessions, or managing stored knowledge.
  AgentJournal indexes Copilot CLI and Claude Code sessions for semantic search and knowledge decay.
---

# Agent Journal

Set up and activate [AgentJournal](https://www.nuget.org/packages/AgentJournal) as the agent's persistent memory, knowledge retrieval, and learning system.

AgentJournal extends what the agent can know beyond the current context window by indexing:
- **Past agent sessions** (Copilot CLI, Claude Code) — searchable conversation history
- **Project documentation** (markdown dirs) — indexed and semantically searchable
- **Explicit knowledge entries** — facts, decisions, patterns the agent has learned and stored with temporal decay

---

## Setup

### Install

```bash
agent-journal --version 2>/dev/null || dotnet tool install --global AgentJournal
```

### Index Copilot CLI Sessions

```bash
agent-journal index --agent copilot-cli        # Copilot CLI sessions only
agent-journal index                            # all supported agents
agent-journal index --watch                    # continuous monitoring
```

### Index Project Documentation

Run once (and re-run when docs change significantly):

```bash
agent-journal content index ./docs --recursive --project <project-name>
agent-journal content index ./README.md --project <project-name>
agent-journal content index ./AGENTS.md --project <project-name>
```

This makes architecture decisions, API docs, and design notes available for semantic search in any future session.

---

## How the Agent Uses This

AgentJournal is the agent's long-term memory. These are the behaviors the agent should follow:

### On Session Start — Retrieve Context Before Acting

Use both `/chronicle` and agent-journal together — they are complementary, not redundant:

| Tool | Best for |
|------|----------|
| `/chronicle standup` | Fast narrative of *recent* work (last few sessions) |
| `agent-journal search` | Deep historical + semantic search across *all* sessions |
| `agent-journal knowledge recall` | Explicit stored facts and decisions |

**Step 1 — Quick recent context via chronicle** (requires `/experimental on`):
```
/chronicle standup
```
This gives an AI-synthesized summary of what was recently worked on. Use it to orient before diving into deeper retrieval.

**Step 2 — Deep search via agent-journal**:
```bash
# Hybrid search (lexical + semantic) across all indexed data
agent-journal search "<task description or keywords>" --mode hybrid --context 3

# Search only indexed documentation
agent-journal content search "<topic>"

# Recall relevant stored knowledge
agent-journal knowledge recall "<topic>"
```

Surface relevant results and incorporate them into your understanding before taking action. Prior sessions may contain: decisions already made, patterns established, mistakes to avoid, architecture choices, or completed prior work.

### During Work — Capture Insights as They Emerge

Don't wait until the end. When you discover something important — a pattern, a constraint, a fix — store it immediately:

```bash
agent-journal knowledge remember "<insight>" --project <project-name>
```

Examples of what to remember:
- "The auth service requires X-Tenant-Id on all requests — missing it returns 401 not 403"
- "Integration tests require UseEnvironment('Testing') on the TestServer"
- "SearchParameter parsing uses FrozenDictionary; do not use in EF Core .Contains() — runtime error"

### When Encountering Unfamiliar Code or Patterns

Before guessing, retrieve context:

```bash
agent-journal search "<class name or pattern>" --mode hybrid
agent-journal content search "<topic>"
```

### On Session End — Consolidate Learning

After completing work, index the session and reinforce knowledge that was relied upon:

```bash
agent-journal index --agent copilot-cli
agent-journal knowledge reinforce <id>         # resets decay timer
agent-journal knowledge remember "<what was learned>"
```

### Reinforcing Knowledge (Preventing Decay)

Knowledge entries decay with a 90-day half-life by default. Reinforce facts you rely on so they remain highly weighted in future searches:

```bash
agent-journal knowledge reinforce <id>
```

---

## Reference

### Search Options

```bash
agent-journal search "<query>" --mode hybrid    # lexical + semantic (best quality)
agent-journal search "<query>" --mode semantic  # vector similarity only
agent-journal search "<query>" --mode lexical   # exact/keyword match only
agent-journal search "<query>" --context 5      # surrounding context lines
agent-journal search "<query>" -p <project>     # filter to a project
```

### Content (Documentation) Commands

```bash
agent-journal content index <path> --recursive --project <name>
agent-journal content search "<query>"
agent-journal content list
agent-journal content reinforce <id>
agent-journal content remove <id>
```

### Knowledge Commands

```bash
agent-journal knowledge remember "<fact>" --project <name>
agent-journal knowledge recall "<topic>"
agent-journal knowledge reinforce <id>
agent-journal knowledge forget <id>
```

### Config

```bash
agent-journal config                        # view settings
agent-journal config set halfLife 30        # decay half-life in days (default: 90)
```

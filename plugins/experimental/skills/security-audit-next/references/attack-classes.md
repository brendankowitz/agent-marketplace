# Attack classes

Prompts for where to look. They are starting points, not a checklist: a class matters only
where the target has the surface for it. Every lead still has to pass `evidence-bar.md`.

**Contents:** Core (always) · Web and authentication · Data isolation and lifecycle ·
Supply chain and CI · Cloud and deployment · AI, LLM and agents · Protocols and messaging ·
Memory safety and native code · Availability · Wildcard

## Core (always)

**Injection.** Follow untrusted input to a sink that interprets it: SQL and other queries,
shell commands, templates, HTML, file paths, redirects, deserializers, regexes, log lines.
Look past values to keys, field names, headers and filenames. Look for second-order use:
data stored safely, then read back and interpreted by different code.

**Access control.** A check existing is not enough. Is it the right permission, for this
resource, for this principal? Look for a second path to the same state change with a weaker
check, a request field that overrides what the permission meant to restrict, endpoints that
authenticate but never authorize, object IDs taken from the request without an ownership
check, and bulk, batch, import and export operations that skip the per-item check.

**Files, URLs and resources.** Path traversal including encoded segments and symlinks,
archive extraction outside the target directory, server-side requests to a caller-chosen URL
(including after a redirect), unsafe deserialization, temp-file races, and check-then-use
gaps.

**Cryptography and secrets.** Predictable randomness for tokens or keys, secrets in source,
logs, URLs, error messages or client responses, missing signature or MAC verification,
personal or tenant data written to logs or telemetry, algorithm or key confusion, nonce or IV reuse, non-constant-time comparison of secrets, and
an error path that falls back to no protection.

**Business logic.** Steps skipped or replayed in a workflow, partial failure that leaves
step one applied, check-then-act races (double spend, double approve), negative, zero or
overflowing quantities, expiry and time-window edges, and the security posture when
configuration is missing or a dependency is down. Does it fail open?

**Feature abuse and leakage.** Export or backup that returns more than the caller may see,
import or restore that bypasses validation, search, filter or sort used to probe hidden
data, different errors or timings for "does not exist" and "not allowed", preview and draft
links that unlock more than one item, and webhook or callback URLs the server fetches.

**Chains and trust gaps.** Component A validates and hands to B: compare what A guarantees
with what B assumes (truncation, type coercion, normalization, tenant scope). A token, key
or role that grows broader after delegation, refresh or caching. Restore, undelete and
rollback paths that skip today's authorization.

## Web and authentication

Sessions: fixation, tokens that survive logout or password change, cookies without the
right scope. CSRF on state-changing requests that rely on ambient credentials. JWT:
algorithm confusion, missing audience, issuer or expiry checks, key lookup driven by the
token itself. OAuth and OIDC: redirect URI matching, missing state or PKCE, tokens accepted
from the wrong client. SAML: signature coverage and wrapping. Account recovery, invitation,
email change and account linking as takeover paths. MFA that can be skipped by calling the
next step directly. Request parsing that differs between a proxy and the app: smuggling,
host and forwarded-header trust, cache keys that omit something the response depends on.
CORS that reflects any origin with credentials. In the browser: script injection into the
DOM, `postMessage` handlers that trust any origin, prototype pollution, and secrets in
client-side storage.

## Data isolation and lifecycle

Every query, cache key, search index, object-store path and queue message that should carry
a tenant or owner scope: does it, on every path? Background jobs and admin tools that run
without the request's scope. Caches keyed without the tenant. Data that survives deletion in
search, analytics, backups, exports or soft-deleted rows that are still readable. Migrations
and restores that reattach data to the wrong owner. Signed or shareable links that never
expire or cover more than one object.

## Supply chain and CI

Workflows that run untrusted code with secrets or write permission: pull-request triggers
that check out the fork's code, script injection from titles, branch names or comments
interpolated into a shell step, and self-hosted runners reachable from forks. Actions and
base images pinned by mutable tag. Install scripts, unpinned or unlocked dependencies,
private package names that could resolve from a public registry. Release, signing and update
paths: what verifies the artifact, and is that the artifact that gets installed? Plugin and
extension loading from locations a less trusted party can write.

## Cloud and deployment

Read what the repository contains: infrastructure code, manifests, Dockerfiles, policy
files. Identity policies with wildcards on actions or resources, roles any principal can
assume, storage or endpoints open to the public, secrets in environment blocks or image
layers, containers running privileged or with the host's namespaces or sockets, network
policy that allows more than the comment above it says, and serverless or webhook handlers
that trust an event without verifying its source. What the live account is set to is a
`needs_validation` fact.

## AI, LLM and agents

Treat model output and retrieved content as untrusted input. Prompt injection through
documents, web pages, tool results, file names or memory that reaches a model which can act.
Tool calls whose arguments the model picks without the application binding them to the
user's own permissions. A confirmation shown for one action while a different one runs.
Model output placed into HTML, SQL, a shell or a file path. Retrieval or memory shared
across users or tenants. System prompts or tool definitions that hold secrets. MCP servers:
who may connect, what each tool can reach, and whether tool descriptions can be changed by
a less trusted party.

## Protocols and messaging

Deserialization of caller-controlled types. Queue and event consumers that trust a message
as if an authenticated user sent it. Webhooks without signature and replay checks. GraphQL:
field-level authorization, introspection, batching and nesting that skip per-request
limits. gRPC and custom protocols: per-method authorization, length fields trusted before
they are bounded, and state machines that accept messages out of order.

## Memory safety and native code

Applies to C, C++, Objective-C, Rust `unsafe`, Go `unsafe` and cgo, .NET `unsafe`, `Span`
and `stackalloc` misuse, P/Invoke and other FFI, and to parsers, decoders and loaders that
handle untrusted bytes. Re-derive each bound from what the attacker controls, for the worst
accepted input and across every caller.

- **Bounds.** A length, offset or index reaches a buffer without a correct check. Recompute
  the room left after headers, padding and terminators. Check source and destination.
- **Integers.** Arithmetic on attacker-controlled sizes before allocation, copy or indexing:
  `a - b` with `b > a`, `count * size`, sums near the type maximum, signed to unsigned,
  64-bit narrowed to 32, `-1` used as a sentinel then as a size.
- **Units.** Bytes mixed with elements, characters, code units or pages between the check,
  the allocation and the copy.
- **Lifetime.** Use after free, double free, a pointer or slice kept across a realloc, and
  callbacks, timers or iterators that outlive their owner, especially on error, cancel and
  close paths.
- **Type confusion.** A tag or discriminator checked one way and the data read another.
- **Uninitialized data.** Padding or unused capacity returned, serialized or sent out.
- **Concurrency.** Unsynchronized reference counts, check-then-use on shared state, and
  teardown racing with use.
- **FFI.** The two sides disagree on who frees, how long a pointer lives, whether a length
  is bytes or elements, or on struct layout, packing and integer width. Exceptions or panics
  crossing a boundary that forbids them.
- **Loading.** A privileged process loads a library, plugin or helper from a path a less
  trusted party can write, or verifies one file and maps another.

Source review can establish the missing or wrong check. Whether it is exploitable beyond a
crash usually depends on the allocator, compiler and platform. Claim only the defect the
source shows; if impact rests on those facts, the record is `needs_validation`, with a
sanitizer or fuzz run named as the owner's safe check.

## Availability

Only where one less trusted actor can degrade a resource others share. Unbounded input
size, count, nesting or decompression ratio. Regexes with catastrophic backtracking on
caller input. A cheap request that triggers expensive work, fan-out, or spend on a paid API.
Locks, connections or workers held while waiting on something the caller controls.

## Wildcard

No category. Read the code that looks boring, strange, half-finished or bolted on: it had
the least review. What can the API do that the UI never asks for? What happens when two
features that were not designed together are combined? What do the tests not cover? What
does `git log` show being reverted, disabled or marked temporary? Which comments explain why
something is safe, and is the explanation true? Read anything named `legacy`, `compat`,
`temp`, `hack` or `debug` until you can say whether it is safe.

# Free Research intent and execution visibility

Status: implemented; acceptance evidence is recorded in the companion report.

The approved repair uses the embedded Pi SDK, existing HTTP/SSE transport and
Workflow services. Pi provides message and tool lifecycle events; ResearchHub
owns request correlation, object confirmation, Workflow association and source
progress. This change does not introduce an Agent Runtime or change Knowledge
Schema or canonical write authorization.

## Intent and confirmation

The semantic dispatcher understands the requested object and objective before
requiring execution-level identifiers. Registered Workflow inputs remain the
execution contract. A name-only Company request can be resolved through the
trusted security directory before the input is checked for completeness.

Full name/code matches start automatically only when unique. Pinyin, initials,
name fragments and ambiguous matches require selection from the complete A-share
directory. Matching includes alternate pronunciations and has no result-count
truncation; the browser paginates the candidate list. Directory failure never
permits model-memory identities. Selected identities are revalidated at start.

`POST /api/research/dispatch` can return `needs_clarification`. Its clarification
contains a confirmation ID, kind, object query, optional Workflow ID, candidate
list, directory timestamp/version, missing fields and a question. Confirmations
expire after fifteen minutes and are regenerated rather than launching an expired
choice. `POST /api/research/dispatch/confirm` accepts the original conversation and
operation IDs, confirmation ID, optional candidate ID/directory version, and
optional clarification text. It reuses the original authorization policies and
admits at most one start. A lone object asks for a research objective after
selection; that answer can choose a different registered Workflow.

Semantic output is repaired at most once. Persistent failure becomes an explicit
failure, not ordinary Free Research. Public diagnostics distinguish model calls,
timeouts, JSON parsing, semantic decisions and Workflow arguments, with safe
codes and field paths. User-provided historical cutoffs are required for `asOf`.

## Execution ownership and observation

Conversation sidecar version 3 reads version 2 and upgrades old single-Workflow
links into a collection. Accepted request text and policies remain immutable.
The sidecar stores clarification, safe dispatch feedback, tool lifecycle and
multiple associated Workflow IDs. Pi retains transcript authority.

Tool execution captures conversation/operation ownership before starting a
Workflow. The task association is saved immediately. Stopping the Agent cancels
preparation and the Agent's wait, while a started Workflow retains its own
cancellation signal. Each Workflow has a separate cancel control. Restart
snapshots mark unfinished tasks interrupted; they do not restore live execution.

Company acquisition publishes discovery, download, body-read, parsing and
structured-data activities as they happen. Stable activity IDs update the same
record; timestamps describe real boundaries. Activity history is bounded to 500
records per Workflow. No inferred percentage or hidden reasoning is exposed.

Company Research defaults are thirty seconds for download including response
body, 120 seconds per document parse and ten minutes for total acquisition.
Cancellation reaches fetch signals and parser/subprocess execution. A timed-out
source is recorded and already-acquired evidence is retained. Existing quality
gates determine partial or blocked output. Other workflows retain their document
parser defaults.

## Presentation and recovery

The conversation shows object confirmation, request feedback and safe execution
cards. The right panel shows every associated task, stages, sources, elapsed time,
errors and verified artifact actions. The composer retains input, attachment,
send and Agent-stop controls. The compact layout retains the existing drawer.

Tool-only assistant messages are not empty answer bubbles. Errors and cancellation
are request activity; readable text is reconciled with Pi message identities.
Internal appended research context, raw tool payloads and hidden reasoning are
excluded. SSE activity updates trigger authoritative snapshot reconciliation;
Workflow polling provides producer-owned stage/source progress after refresh or
conversation switching.

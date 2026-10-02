# Theme Framework

## Purpose

Propose an evidence-grounded, bounded Industry network for a named Investment
Theme. The result is a reviewable set of Industry and directed Relation
candidates, scope recommendations, and coverage gaps. It does not create or
write canonical Knowledge.

## Invocation Match

Use when a user explicitly asks to establish or reassess a Theme's industry
scope. The Theme name is required; a definition is optional. Construction and
later impact review are Workflow-owned missions that may call this peer Skill.

## Inputs

- Theme name and optional definition.
- A bounded summary of existing Knowledge and allowlisted existing Industry
  refs.
- Bounded evidence records, each with an evidence ref, origin, description,
  source ref, and optional date and excerpt.
- Prior scope decisions with their semantic fingerprints and evidence refs.

Never assume the summary contains every relevant Industry or edge. Do not ask
for or process an unbounded Knowledge Base dump.

## Produces

- A supported or explicitly provisional Theme definition and inclusion /
  exclusion principles.
- Industry candidates at a consistent, independently researchable economic
  activity granularity. Products, technologies, and narrow product families
  normally remain descriptive detail of their Industry.
- Directed `upstream_of` or `depends_on` Relation candidates, classified as
  main-chain or cross-chain.
- Separate `include`, `exclude`, or `pending` recommendations for every
  candidate, with boundary and relevance rationales, evidence refs, and
  coverage gaps.
- Stable semantic fingerprints for matching later decisions. A changed prior
  recommendation is a `reopen` only when at least one newly available evidence
  ref supports reconsideration.

## Methodology

1. Interpret the Theme's investable question and its definition. State what
   economic need, technology dependence, supply constraint, cost, moat, or
   competitive position would make an Industry decision-relevant.
2. Identify independently researchable economic activities and keep adjacent
   chain stages at comparable granularity. A product or technology alone is
   not an Industry unless the supplied context supports a distinct researchable
   economic activity.
3. Assess each candidate's relationship to the Theme separately from whether
   a supply-chain or dependency Relation is true. A real edge does not imply
   that both endpoints belong in the Theme.
4. Trace only bounded, decision-relevant breadth. Stop when marginal research
   value is low, the candidate is weakly connected to the Theme's economics,
   or the available evidence cannot support a decision. Do not use a fixed hop
   count or continue traversal simply because another edge exists.
5. Preserve meaningful cross-chain connections and include a related
   independently researchable infrastructure service when supported, even if
   it has no `upstream_of` path to the central chain. Never invent an edge to
   make the graph connected.
6. Recommend `pending` when evidence is insufficient or Theme value is unclear.
   `include` and `exclude` recommendations both require supplied evidence.
   Evidence gaps must name the unresolved question and why it matters.
7. Carry forward prior decisions without re-proposing them. To change a prior
   recommendation, cite new evidence not present in that decision's evidence
   refs; otherwise validation blocks reopening. Omit unchanged exclusions from
   the candidate set when they need no current review.

## Relation direction

- `upstream_of`: the source Industry supplies an economic input or earlier
  chain-stage output to the target Industry.
- `depends_on`: the source Industry depends on the target Industry or service.
- `cross_chain` describes a real edge linking distinct branches. It does not
  change edge direction or make either node in-scope automatically.

## Evidence and Knowledge boundary

Use only exact evidence refs and existing Industry refs supplied in the input.
An included or excluded Industry / Relation must cite evidence. A pending
candidate may have no evidence, but must state what is missing. Statements
about sources must not exceed their supplied descriptions or excerpts.

This Skill allocates no canonical IDs, invokes no other Skill or Workflow, and
does not call Gateway, Validation, ChangeSet, or Writer. Workflow owns source
acquisition, human review, persistence, and any canonical Knowledge projection.

## Missing data and QC

Return pending decisions and coverage gaps for unavailable or ambiguous
evidence. Reject unknown refs, duplicate candidate identities, malformed
fields, unsupported recommendations, relations with unknown endpoints,
included relations whose candidate endpoints are not included, and cyclic
included directed chain / dependency relations. Isolated nodes and cross-chain
links are valid. A blocked semantic result must not be presented as a partial
confirmed Theme framework.

## Related Skills

Industry Research is a peer capability that may later research a selected
Industry. This Skill does not dispatch it; a Workflow decides if and when to
call peer Skills.

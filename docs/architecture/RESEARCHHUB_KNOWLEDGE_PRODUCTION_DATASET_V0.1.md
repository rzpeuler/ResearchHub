# ResearchHub Knowledge Production Dataset v0.1

## Status

Architecture Freeze / AI Hardware production population

## Boundary

The production dataset is a semantic migration of the validated AI Hardware
prototype. `tests/knowledge/industry-graph.*` remains a legacy frontend
benchmark. It is not copied into `knowledge/` as a monolithic JSON object.

The production path is:

```text
knowledge assets -> Registry -> Loader / Runtime Index -> Access Skill
                  -> Workflow / Frontend consumer
```

## Data policy

- Entity stores stable identity and listing metadata only.
- Market size, revenue, forecasts, risks, trends, and viewpoints are
  Intelligence objects.
- Company segment revenue belongs on the `operates_in` Relation when directly
  disclosed for that segment; otherwise the field is omitted.
- Research reports are Source objects and are linked through `sourceRefs`.
- Unverified claims, guessed values, mock sources, and placeholder images are
  not production data.
- Taxonomy and View files are read-oriented/auxiliary assets; core runtime
  assets remain Entity, Relation, Intelligence, Module, Source, and Registry.

## Initial coverage

AI Hardware includes GPU, HBM, PCB Material, PCB Manufacturing, Optical
Module, Server, Liquid Cooling, and Data Center. The first company set covers
NVIDIA, AMD, SK hynix, Samsung, Micron, Shengyi Technology, WUS Printed
Circuit (沪电股份), Shennan Circuits, Inspur Information, and Foxconn
Industrial Internet.

## Completeness rule

Production completeness means every registered asset is source-traceable and
schema-valid; it does not mean every prototype field is populated. Missing
market-share, company-segment-revenue, certification, or image evidence is a
valid omitted state for v0.1.

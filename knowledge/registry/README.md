# Knowledge Registry Assets

Registry files map stable Knowledge IDs to asset paths. When a Registry exists,
the Loader treats it as authoritative and does not scan unregistered runtime
assets. `modules.yaml` separately maps Entity IDs to registered Module IDs.
Taxonomy and View files are auxiliary read-oriented assets in v0.1 and are not
runtime asset entries in `index.yaml`.

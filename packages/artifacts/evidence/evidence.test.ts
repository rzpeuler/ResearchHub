import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidence,
  deserializeEvidence,
  isEvidence,
  serializeEvidence,
  validateEvidence,
} from "./index.js";

const input = {
  id: "evidence-001",
  createdAt: "2026-08-23T09:00:00.000Z",
  sessionId: "session-001",
  metadata: { category: "market" },
  source: "validation-fixture",
  content: "The validation fixture contains structured evidence.",
  timestamp: "2026-08-23T09:01:00.000Z",
  confidence: 0.8,
};

test("creates and validates an Evidence artifact", () => {
  const evidence = createEvidence(input);

  assert.equal(evidence.type, "evidence");
  assert.equal(evidence.sessionId, "session-001");
  assert.equal(evidence.source, "validation-fixture");
  assert.equal(isEvidence(evidence), true);
});

test("rejects invalid Evidence confidence", () => {
  assert.throws(() => validateEvidence({ ...input, type: "evidence", confidence: 1.1 }));
});

test('rejects malformed Evidence before normalization', () => {
  assert.throws(() => createEvidence({ ...input, metadata: undefined as never }));
  assert.throws(() => serializeEvidence({ ...input, type: 'evidence', source: undefined } as never));
});

test("round-trips Evidence through JSON serialization", () => {
  const evidence = createEvidence(input);
  const restored = deserializeEvidence(serializeEvidence(evidence));

  assert.deepEqual(restored, evidence);
});

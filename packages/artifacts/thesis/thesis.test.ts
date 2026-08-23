import assert from "node:assert/strict";
import test from "node:test";

import {
  createThesis,
  deserializeThesis,
  isThesis,
  serializeThesis,
  validateThesis,
} from "./index.js";

const input = {
  id: "thesis-001",
  createdAt: "2026-08-23T09:10:00.000Z",
  sessionId: "session-001",
  metadata: { category: "research" },
  statement: "The evidence supports a testable research thesis.",
  evidenceIds: ["evidence-001"],
  confidence: 0.7,
  risks: ["Fixture data is not a live market source."],
};

test("creates a Thesis linked to Evidence IDs", () => {
  const thesis = createThesis(input);

  assert.equal(thesis.type, "thesis");
  assert.deepEqual(thesis.evidenceIds, ["evidence-001"]);
  assert.equal(isThesis(thesis), true);
});

test("rejects invalid Thesis relationships", () => {
  assert.throws(() => validateThesis({ ...input, type: "thesis", evidenceIds: [""] }));
});

test('rejects malformed Thesis before normalization', () => {
  assert.throws(() => createThesis({ ...input, evidenceIds: 'evidence-001' as never }));
  assert.throws(() => serializeThesis({ ...input, type: 'thesis', risks: undefined } as never));
});

test("round-trips Thesis through JSON serialization", () => {
  const thesis = createThesis(input);
  const restored = deserializeThesis(serializeThesis(thesis));

  assert.deepEqual(restored, thesis);
});

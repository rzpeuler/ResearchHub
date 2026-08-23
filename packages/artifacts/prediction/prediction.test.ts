import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrediction,
  deserializePrediction,
  isPrediction,
  serializePrediction,
  validatePrediction,
} from "./index.js";

const input = {
  id: "prediction-001",
  createdAt: "2026-08-23T09:20:00.000Z",
  sessionId: "session-001",
  metadata: { category: "forecast" },
  thesisId: "thesis-001",
  expectation: "The test subject will meet the stated expectation.",
  evaluationPeriod: {
    start: "2026-08-24T00:00:00.000Z",
    end: "2026-08-31T23:59:59.000Z",
  },
  metrics: { target: 1, unit: "fixture" },
};

test("creates a Prediction linked to a Thesis ID", () => {
  const prediction = createPrediction(input);

  assert.equal(prediction.type, "prediction");
  assert.equal(prediction.thesisId, "thesis-001");
  assert.equal(isPrediction(prediction), true);
});

test("rejects an invalid Prediction evaluation period", () => {
  assert.throws(() =>
    validatePrediction({
      ...input,
      type: "prediction",
      evaluationPeriod: {
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-08-31T23:59:59.000Z",
      },
    }),
  );
});

test('rejects malformed Prediction before normalization', () => {
  assert.throws(() => createPrediction({ ...input, metrics: ['invalid'] as never }));
  assert.throws(() => serializePrediction({ ...input, type: 'prediction', thesisId: undefined } as never));
});

test("round-trips Prediction through JSON serialization", () => {
  const prediction = createPrediction(input);
  const restored = deserializePrediction(serializePrediction(prediction));

  assert.deepEqual(restored, prediction);
});

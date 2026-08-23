import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactValidationError,
  deserializeArtifact,
  isJsonValue,
  serializeArtifact,
  validateArtifactBase,
  type ArtifactBase,
} from './index.ts';

const validEvidenceBase: ArtifactBase<'evidence'> = {
  id: 'evidence-001',
  type: 'evidence',
  createdAt: '2026-08-23T08:00:00.000Z',
  sessionId: 'session-001',
  metadata: {
    author: 'research-agent',
    tags: ['market'],
  },
};

describe('artifact core', () => {
  it('validates a supported artifact base', () => {
    assert.doesNotThrow(() => validateArtifactBase(validEvidenceBase));
  });

  it('rejects unsupported types and invalid timestamps', () => {
    assert.throws(
      () => validateArtifactBase({ ...validEvidenceBase, type: 'review' }),
      (error: unknown) => error instanceof ArtifactValidationError && error.path === '$.type',
    );

    assert.throws(
      () => validateArtifactBase({ ...validEvidenceBase, createdAt: 'not-a-timestamp' }),
      (error: unknown) => error instanceof ArtifactValidationError && error.path === '$.createdAt',
    );
  });

  it('rejects non-JSON-safe metadata values', () => {
    assert.equal(isJsonValue({ valid: true, nested: [1, 'two', null] }), true);
    assert.equal(isJsonValue({ invalid: undefined }), false);
    assert.equal(isJsonValue({ invalid: Number.NaN }), false);

    assert.throws(
      () => serializeArtifact({ ...validEvidenceBase, metadata: { invalid: undefined } } as never, validateArtifactBase),
      ArtifactValidationError,
    );

    const cyclicMetadata: Record<string, unknown> = {};
    cyclicMetadata.self = cyclicMetadata;
    assert.equal(isJsonValue(cyclicMetadata), false);
    assert.throws(
      () => serializeArtifact({ ...validEvidenceBase, metadata: cyclicMetadata } as never, validateArtifactBase),
      ArtifactValidationError,
    );
  });

  it('round-trips a validated artifact through JSON', () => {
    const serialized = serializeArtifact(validEvidenceBase, validateArtifactBase);
    const restored = deserializeArtifact(serialized, validateArtifactBase);

    assert.deepEqual(restored, validEvidenceBase);
    assert.notStrictEqual(restored, validEvidenceBase);
    assert.equal(restored.sessionId, 'session-001');
  });

  it('rejects malformed serialized artifacts', () => {
    assert.throws(
      () => deserializeArtifact('{"id":"missing-fields"}', validateArtifactBase),
      (error: unknown) => error instanceof ArtifactValidationError && error.path === '$.type',
    );

    assert.throws(
      () => deserializeArtifact('not-json', validateArtifactBase),
      (error: unknown) => error instanceof ArtifactValidationError && error.message.startsWith('invalid JSON:'),
    );
  });
});

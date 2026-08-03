import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { generateComplex, generateFixture, generateGroups } from './helpers.js';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('matches the locked generated-source SHA-256 baseline', () => {
  assert.equal(
    sha256(generateFixture()),
    'e49f21754493f79879f29dbcf8a415ef7760a471352d9851f37fb7fb6fabaa6f'
  );

  const complex = generateComplex();
  assert.deepEqual({
    'Complex.ets': sha256(readFileSync(join(complex, 'Complex.ets'))),
    'Shared.ets': sha256(readFileSync(join(complex, 'Shared.ets')))
  }, {
    'Complex.ets': 'a9352594d50fc2fd4f22b881176f50741541f814523a5ae5eb7516d60b773125',
    'Shared.ets': '687a7cdbe3f2dd1dca83038556f44cd0bb9e721a25ec4e4c7aaa66ca9759a01f'
  });

  const groups = generateGroups();
  assert.deepEqual({
    'legacy/common/Backref.ets': sha256(readFileSync(join(groups, 'legacy/common/Backref.ets'))),
    'legacy/common/Shared.ets': sha256(readFileSync(join(groups, 'legacy/common/Shared.ets'))),
    'v2/gateway/Envelope.ets': sha256(readFileSync(join(groups, 'v2/gateway/Envelope.ets')))
  }, {
    'legacy/common/Backref.ets': '8ba8e14bc289ff103d02ee6a9789014cbb0a486193c02224d7aad8611e0eb561',
    'legacy/common/Shared.ets': '7faa0888945ce29a04bb35ec567a26c250919029e1091528446af373674afadd',
    'v2/gateway/Envelope.ets': 'c62ed6609e9a8acb37b2fb678607cee0ce6be75558ec83306e9a1a6db1f9cac6'
  });
});

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
    '9c1df3be2a20fd8fde3a7526da78de305f4231715fcca9bcdb8e235734159012'
  );

  const complex = generateComplex();
  assert.deepEqual({
    'Complex.ets': sha256(readFileSync(join(complex, 'Complex.ets'))),
    'Shared.ets': sha256(readFileSync(join(complex, 'Shared.ets')))
  }, {
    'Complex.ets': '7647135a6daa745ed3ce760fbf3b50268cf91a25e49fe3c231ca52dee99ec29c',
    'Shared.ets': '010b931f3cac68d774b153c4e6d540615c5b34e3b0086453f59fdeb7da636692'
  });

  const groups = generateGroups();
  assert.deepEqual({
    'legacy/common/Backref.ets': sha256(readFileSync(join(groups, 'legacy/common/Backref.ets'))),
    'legacy/common/Shared.ets': sha256(readFileSync(join(groups, 'legacy/common/Shared.ets'))),
    'v2/gateway/Envelope.ets': sha256(readFileSync(join(groups, 'v2/gateway/Envelope.ets')))
  }, {
    'legacy/common/Backref.ets': '287aa77b2a878e9e7426c4193b3c1727f401744e11bf79cce44704e94aaad9c8',
    'legacy/common/Shared.ets': '9ffb0e5191ea4159e2a548afd2086c9beb32c9580efd406de6735e513d9da619',
    'v2/gateway/Envelope.ets': 'bbd8920c6c6a057c17cc5dd124792e601c845d405d44cd24e5d09d5cab7b2269'
  });
});

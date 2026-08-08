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
    '001bcfbaa3a509751e6e029486a53809fcae18dda2b9a6b6160e4930de6df43d'
  );

  const complex = generateComplex();
  assert.deepEqual({
    'Complex.ets': sha256(readFileSync(join(complex, 'Complex.ets'))),
    'Shared.ets': sha256(readFileSync(join(complex, 'Shared.ets')))
  }, {
    'Complex.ets': 'f884217d31822ea9420d8a9e97dc9ef4d79e48fd3821592aab805699db9cea1b',
    'Shared.ets': 'c928c0261099defdd4d7ddf05c508bbec7dba7325d22cd295fdd9d3486d52e39'
  });

  const groups = generateGroups();
  assert.deepEqual({
    'legacy/common/Backref.ets': sha256(readFileSync(join(groups, 'legacy/common/Backref.ets'))),
    'legacy/common/Shared.ets': sha256(readFileSync(join(groups, 'legacy/common/Shared.ets'))),
    'v2/gateway/Envelope.ets': sha256(readFileSync(join(groups, 'v2/gateway/Envelope.ets')))
  }, {
    'legacy/common/Backref.ets': 'a4db8565a5470dd1a09eccbcd1095fdde149b0c50593ccc6e9e1435499a057e2',
    'legacy/common/Shared.ets': '033be9607d691cbc702cd7a0d535cd844dd15d1750c5c9f8b3e0dcb7cdeda3bb',
    'v2/gateway/Envelope.ets': 'd22972f52ef40e90720a747cefaa1a646e2514070e3ef452722331edc2569219'
  });
});

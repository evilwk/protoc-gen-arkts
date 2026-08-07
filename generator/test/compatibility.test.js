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
    '4a82edd5dfcea665646f7d301e9059390a488598776442ca115214c861e6b807'
  );

  const complex = generateComplex();
  assert.deepEqual({
    'Complex.ets': sha256(readFileSync(join(complex, 'Complex.ets'))),
    'Shared.ets': sha256(readFileSync(join(complex, 'Shared.ets')))
  }, {
    'Complex.ets': '921a140a57ea171049c126ee0480303467788c122d610f3216518f00de1431bc',
    'Shared.ets': 'a9ccfd3da4a6457ab5aa3bbb0d018524d4351949639e4bc6afbc35c8a55cd4cc'
  });

  const groups = generateGroups();
  assert.deepEqual({
    'legacy/common/Backref.ets': sha256(readFileSync(join(groups, 'legacy/common/Backref.ets'))),
    'legacy/common/Shared.ets': sha256(readFileSync(join(groups, 'legacy/common/Shared.ets'))),
    'v2/gateway/Envelope.ets': sha256(readFileSync(join(groups, 'v2/gateway/Envelope.ets')))
  }, {
    'legacy/common/Backref.ets': 'e513ff438aa84bf74196f0ce7082e7d2d036bc5c3b6ad084f6af8e44a48b8cc1',
    'legacy/common/Shared.ets': '74b86ffa438bfe10aa1c713d9823968e0055c81df1c289ec6323faf4b41b6394',
    'v2/gateway/Envelope.ets': 'f69c0da5203f815669a61dedcd2db8e7ddf675fc881e2b5e962d59b559f03ca1'
  });
});

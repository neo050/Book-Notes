import test from 'node:test';
import assert from 'node:assert/strict';
test('olSearch handles empty query without network', async () => {
  const { searchWorks } = await import('../services/olSearch.js');
  assert.deepEqual(await searchWorks(''), []);
  assert.deepEqual(await searchWorks('   '), []);
});

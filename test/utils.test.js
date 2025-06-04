import test from 'node:test';
import assert from 'node:assert/strict';
import { isStrongPassword } from '../utils.js';

test('accepts strong passwords', () => {
  const valid = ['abc12345', 'Password1', 'A1b2c3d4'];
  for (const pwd of valid) {
    assert.ok(isStrongPassword(pwd), `${pwd} should be valid`);
  }
});

test('rejects weak passwords', () => {
  const invalid = ['short', '1234567', 'abcdefg', 'abc123'];
  for (const pwd of invalid) {
    assert.ok(!isStrongPassword(pwd), `${pwd} should be invalid`);
  }
});

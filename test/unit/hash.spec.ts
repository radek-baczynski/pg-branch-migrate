import { describe, expect, it } from 'vitest';
import { hashMigrationContent, sha256 } from '../../src/hash.js';

describe('hash helpers', () => {
  it('computes stable SHA-256 hashes', () => {
    expect(sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('uses SHA-256 for migration content hashes', () => {
    expect(hashMigrationContent('migration')).toBe(sha256('migration'));
  });
});

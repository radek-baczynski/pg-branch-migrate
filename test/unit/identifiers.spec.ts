import { describe, expect, it } from 'vitest';
import {
  normalizeSearchPath,
  qualifiedName,
  quoteIdentifier,
} from '../../src/identifiers.js';

describe('identifier helpers', () => {
  it('quotes and escapes PostgreSQL identifiers', () => {
    expect(quoteIdentifier('plain')).toBe('"plain"');
    expect(quoteIdentifier('needs"escaping')).toBe('"needs""escaping"');
  });

  it('builds quoted qualified names', () => {
    expect(qualifiedName('my schema', 'migration table')).toBe(
      '"my schema"."migration table"'
    );
  });

  it('normalizes search path options', () => {
    expect(normalizeSearchPath(undefined)).toEqual([]);
    expect(normalizeSearchPath('app')).toEqual(['app']);
    expect(normalizeSearchPath(['app', 'public'])).toEqual(['app', 'public']);
  });
});

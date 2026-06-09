import { describe, expect, it } from 'vitest';
import { defineMigration } from '../../src/migration.js';
import type { MigrationDefinition } from '../../src/types.js';

describe('defineMigration', () => {
  it('returns the migration definition unchanged for typed authoring', () => {
    const definition: MigrationDefinition = {
      revision: '0001_init',
      async up() {},
      async down() {},
    };

    expect(defineMigration(definition)).toBe(definition);
  });
});

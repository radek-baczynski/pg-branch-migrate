import { describe, expect, it } from 'vitest';
import { stateSchema, stateTable, stateTableName } from '../../src/state.js';

describe('state table helpers', () => {
  it('uses public.pg_migration_revisions by default', () => {
    expect(stateSchema({ migrationsDir: 'migrations' })).toBe('public');
    expect(stateTable({ migrationsDir: 'migrations' })).toBe(
      'pg_migration_revisions'
    );
    expect(stateTableName({ migrationsDir: 'migrations' })).toBe(
      '"public"."pg_migration_revisions"'
    );
  });

  it('quotes custom schema and table names', () => {
    expect(
      stateTableName({
        migrationsDir: 'migrations',
        schema: 'my schema',
        table: 'migration"state',
      })
    ).toBe('"my schema"."migration""state"');
  });
});

import type { Client, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { PgMigrationDb } from '../../src/db.js';

interface RecordedQuery {
  text: string;
  values: readonly unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];

  async query(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult> {
    this.queries.push({ text, values });
    return {
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      rows: [],
      fields: [],
    };
  }
}

function migrationDb(client = new FakeClient()): {
  client: FakeClient;
  db: PgMigrationDb;
} {
  return {
    client,
    db: new PgMigrationDb(client as unknown as Client),
  };
}

describe('PgMigrationDb', () => {
  it('parameterizes tagged SQL values', async () => {
    const { client, db } = migrationDb();

    await db.sql`SELECT ${1}::int AS id, ${'Ada'}::text AS name`;

    expect(client.queries).toEqual([
      {
        text: 'SELECT $1::int AS id, $2::text AS name',
        values: [1, 'Ada'],
      },
    ]);
  });

  it('copies query values before passing them to pg', async () => {
    const { client, db } = migrationDb();
    const values = ['before'];

    await db.query('SELECT $1', values);
    values[0] = 'after';

    expect(client.queries[0]?.values).toEqual(['before']);
  });

  it('commits successful top-level transactions', async () => {
    const { client, db } = migrationDb();

    await db.transaction(async () => {
      await db.query('INSERT INTO events VALUES ($1)', ['ok']);
    });

    expect(client.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      'INSERT INTO events VALUES ($1)',
      'COMMIT',
    ]);
  });

  it('rolls back failed top-level transactions', async () => {
    const { client, db } = migrationDb();

    await expect(
      db.transaction(async () => {
        await db.query('INSERT INTO events VALUES ($1)', ['bad']);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(client.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      'INSERT INTO events VALUES ($1)',
      'ROLLBACK',
    ]);
  });

  it('uses savepoints for nested transactions', async () => {
    const { client, db } = migrationDb();

    await db.transaction(async () => {
      await db.query('outer before');
      await db.transaction(async () => {
        await db.query('inner');
      });
      await db.query('outer after');
    });

    expect(client.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      'outer before',
      'SAVEPOINT pgm_sp_1',
      'inner',
      'RELEASE SAVEPOINT pgm_sp_1',
      'outer after',
      'COMMIT',
    ]);
  });

  it('rolls back nested transactions to a savepoint without aborting the outer transaction', async () => {
    const { client, db } = migrationDb();

    await db.transaction(async () => {
      await expect(
        db.transaction(async () => {
          await db.query('inner bad');
          throw new Error('inner boom');
        })
      ).rejects.toThrow('inner boom');
      await db.query('outer recovered');
    });

    expect(client.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      'SAVEPOINT pgm_sp_1',
      'inner bad',
      'ROLLBACK TO SAVEPOINT pgm_sp_1',
      'RELEASE SAVEPOINT pgm_sp_1',
      'outer recovered',
      'COMMIT',
    ]);
  });
});

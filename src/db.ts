import type { Client, QueryResult } from 'pg';
import type { MigrationDb } from './types.js';

function buildSql(
  strings: TemplateStringsArray,
  values: readonly unknown[]
): { text: string; values: readonly unknown[] } {
  let text = strings[0] ?? '';

  for (let i = 0; i < values.length; i += 1) {
    text += `$${i + 1}${strings[i + 1] ?? ''}`;
  }

  return { text, values };
}

export class PgMigrationDb implements MigrationDb {
  readonly #client: Client;
  #transactionDepth = 0;
  #savepointId = 0;

  constructor(client: Client) {
    this.#client = client;
  }

  sql(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<QueryResult> {
    const query = buildSql(strings, values);
    return this.query(query.text, query.values);
  }

  query(text: string, values: readonly unknown[] = []): Promise<QueryResult> {
    return this.#client.query(text, [...values]);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#transactionDepth === 0) {
      await this.query('BEGIN');
      this.#transactionDepth += 1;
      try {
        const result = await fn();
        await this.query('COMMIT');
        return result;
      } catch (error) {
        await this.query('ROLLBACK');
        throw error;
      } finally {
        this.#transactionDepth -= 1;
      }
    }

    this.#savepointId += 1;
    const savepoint = `pgm_sp_${this.#savepointId}`;
    await this.query(`SAVEPOINT ${savepoint}`);
    this.#transactionDepth += 1;
    try {
      const result = await fn();
      await this.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await this.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await this.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }
}

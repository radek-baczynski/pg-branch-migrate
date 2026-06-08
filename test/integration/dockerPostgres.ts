import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type QueryResultRow } from 'pg';

const port = Number(process.env.PG_MIGRATIONS_DAG_TEST_PORT ?? 55439);
const containerName =
  process.env.PG_MIGRATIONS_DAG_TEST_CONTAINER ??
  `pg-branch-migrate-test-${port}`;

export const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/pg_branch_migrate`;

function docker(args: readonly string[]): string {
  return execFileSync('docker', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function dockerIgnore(args: readonly string[]): void {
  try {
    docker(args);
  } catch {
    // Best-effort cleanup for containers from interrupted test runs.
  }
}

async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await delay(1_000);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Timed out waiting for PostgreSQL');
}

export async function startPostgres(): Promise<void> {
  dockerIgnore(['rm', '-f', containerName]);
  docker([
    'run',
    '--rm',
    '--name',
    containerName,
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_DB=pg_branch_migrate',
    '-p',
    `${port}:5432`,
    '-d',
    'postgres:16-alpine',
  ]);
  await waitForPostgres();
}

export function stopPostgres(): void {
  dockerIgnore(['rm', '-f', containerName]);
}

export async function resetSchema(schema: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await client.end();
  }
}

export async function queryRows<T extends QueryResultRow>(
  schema: string,
  sql: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    const result = await client.query<T>(sql, [...values]);
    return result.rows;
  } finally {
    await client.end();
  }
}

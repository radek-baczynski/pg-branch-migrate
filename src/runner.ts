import { Client } from 'pg';
import { PgMigrationDb } from './db.js';
import { buildMigrationGraph, getCurrentHeads, validateAppliedRevisions } from './graph.js';
import { normalizeSearchPath, quoteIdentifier } from './identifiers.js';
import { loadMigrations } from './loader.js';
import { planDown, planUp } from './planner.js';
import {
  deleteAppliedRevision,
  ensureStateTable,
  insertAppliedRevision,
  readAppliedRevisions,
} from './state.js';
import type {
  CheckResult,
  CurrentResult,
  HeadsResult,
  Migration,
  MigrationDirection,
  MigrationGraph,
  MigrationRunResult,
  RunnerOptions,
} from './types.js';

const defaultLockKey = 73_574_231;

async function withClient<T>(
  options: RunnerOptions,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const externalClient = options.client;
  const client =
    externalClient ??
    new Client(
      typeof options.databaseUrl === 'string'
        ? { connectionString: options.databaseUrl }
        : options.databaseUrl
    );

  if (!externalClient) {
    await client.connect();
  }

  try {
    return await fn(client);
  } finally {
    if (!externalClient) {
      await client.end();
    }
  }
}

async function lock(client: Client, lockKey: number): Promise<void> {
  const { rows } = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [lockKey]
  );

  if (!rows[0]?.locked) {
    throw new Error('Another migration run already holds the advisory lock');
  }
}

async function unlock(client: Client, lockKey: number): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
}

async function setSearchPath(
  client: Client,
  options: RunnerOptions
): Promise<void> {
  const schemas = normalizeSearchPath(options.searchPath);
  if (schemas.length === 0) {
    return;
  }

  await client.query(
    `SET search_path TO ${schemas.map((schema) => quoteIdentifier(schema)).join(', ')}`
  );
}

async function loadCheckedGraph(
  options: RunnerOptions,
  client?: Client
): Promise<{
  graph: MigrationGraph;
  migrations: readonly Migration[];
}> {
  const migrations = await loadMigrations({
    migrationsDir: options.migrationsDir,
    logger: options.logger,
  });
  const graph = buildMigrationGraph(migrations);

  if (client) {
    const applied = await readAppliedRevisions(client, options);
    validateAppliedRevisions(graph, applied);
  }

  return { graph, migrations };
}

function appliedSet(
  applied: readonly { revision: string }[]
): ReadonlySet<string> {
  return new Set(applied.map((row) => row.revision));
}

async function runOne(
  client: Client,
  options: RunnerOptions,
  migration: Migration,
  direction: MigrationDirection
): Promise<void> {
  const db = new PgMigrationDb(client);
  const action = async (): Promise<void> => {
    if (direction === 'up') {
      await migration.up(db);
      await insertAppliedRevision(client, options, migration);
    } else {
      await migration.down(db);
      await deleteAppliedRevision(client, options, migration.revision);
    }
  };

  if (migration.transaction === false) {
    await action();
    return;
  }

  await db.transaction(action);
}

async function run(
  options: RunnerOptions,
  direction: MigrationDirection,
  target: string
): Promise<MigrationRunResult> {
  return withClient(options, async (client) => {
    const lockEnabled = options.lock !== false;
    const lockKey = options.lockKey ?? defaultLockKey;

    if (lockEnabled) {
      await lock(client, lockKey);
    }

    try {
      await setSearchPath(client, options);
      await ensureStateTable(client, options);
      const { graph } = await loadCheckedGraph(options, client);
      const applied = await readAppliedRevisions(client, options);
      validateAppliedRevisions(graph, applied);

      const plan =
        direction === 'up'
          ? planUp(graph, appliedSet(applied), target)
          : planDown(graph, appliedSet(applied), target);

      options.logger?.info?.(
        plan.length === 0
          ? 'No migrations to run'
          : `Running ${plan.length} migration(s)`
      );

      for (const migration of plan) {
        options.logger?.info?.(`${direction} ${migration.revision}`);
        await runOne(client, options, migration, direction);
      }

      const nextApplied = await readAppliedRevisions(client, options);
      const currentHeads = getCurrentHeads(graph, appliedSet(nextApplied));

      return {
        direction,
        target,
        migrations: plan.map((migration) => ({
          revision: migration.revision,
          direction,
          filePath: migration.filePath,
        })),
        currentHeads,
      };
    } finally {
      if (lockEnabled) {
        await unlock(client, lockKey).catch((error: unknown) => {
          options.logger?.warn?.((error as Error).message);
        });
      }
    }
  });
}

export function up(
  options: RunnerOptions,
  target = 'head'
): Promise<MigrationRunResult> {
  return run(options, 'up', target);
}

export function down(
  options: RunnerOptions,
  target = '-1'
): Promise<MigrationRunResult> {
  return run(options, 'down', target);
}

export async function current(options: RunnerOptions): Promise<CurrentResult> {
  return withClient(options, async (client) => {
    await ensureStateTable(client, options);
    const { graph } = await loadCheckedGraph(options, client);
    const applied = await readAppliedRevisions(client, options);
    validateAppliedRevisions(graph, applied);

    return {
      applied,
      currentHeads: getCurrentHeads(graph, appliedSet(applied)),
    };
  });
}

export async function getHeads(options: RunnerOptions): Promise<HeadsResult> {
  return withClient(options, async (client) => {
    await ensureStateTable(client, options);
    const { graph } = await loadCheckedGraph(options, client);
    const applied = await readAppliedRevisions(client, options);
    validateAppliedRevisions(graph, applied);

    return {
      graphHeads: graph.heads,
      currentHeads: getCurrentHeads(graph, appliedSet(applied)),
    };
  });
}

export async function getHistory(
  options: Pick<RunnerOptions, 'logger' | 'migrationsDir'>
): Promise<readonly Migration[]> {
  const migrations = await loadMigrations(options);
  const graph = buildMigrationGraph(migrations);

  return graph.topological.map((revision) => {
    const node = graph.nodes.get(revision);
    if (!node) {
      throw new Error(`Unknown revision in history: ${revision}`);
    }

    return node.migration;
  });
}

export async function checkMigrations(
  options: Pick<RunnerOptions, 'logger' | 'migrationsDir'>
): Promise<CheckResult> {
  const migrations = await loadMigrations(options);
  const graph = buildMigrationGraph(migrations);

  return { graph, migrations };
}

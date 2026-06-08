import type { Client } from 'pg';
import { qualifiedName, quoteIdentifier } from './identifiers.js';
import type { AppliedRevision, Migration, RunnerOptions } from './types.js';

const defaultSchema = 'public';
const defaultTable = 'pg_migration_revisions';

export function stateSchema(options: RunnerOptions): string {
  return options.schema ?? defaultSchema;
}

export function stateTable(options: RunnerOptions): string {
  return options.table ?? defaultTable;
}

export function stateTableName(options: RunnerOptions): string {
  return qualifiedName(stateSchema(options), stateTable(options));
}

export async function ensureStateTable(
  client: Client,
  options: RunnerOptions
): Promise<void> {
  const schema = stateSchema(options);
  const tableName = stateTableName(options);

  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      revision text PRIMARY KEY,
      down_revisions text[] NOT NULL,
      branch_labels text[] NOT NULL DEFAULT '{}',
      hash text NOT NULL,
      file_path text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_order bigserial NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export async function readAppliedRevisions(
  client: Client,
  options: RunnerOptions
): Promise<AppliedRevision[]> {
  const { rows } = await client.query<{
    revision: string;
    down_revisions: string[];
    branch_labels: string[];
    hash: string;
    file_path: string;
    applied_at: Date;
    execution_order: string;
    metadata: unknown;
  }>(`
    SELECT
      revision,
      down_revisions,
      branch_labels,
      hash,
      file_path,
      applied_at,
      execution_order,
      metadata
    FROM ${stateTableName(options)}
    ORDER BY execution_order ASC
  `);

  return rows.map((row) => ({
    revision: row.revision,
    downRevisions: row.down_revisions,
    branchLabels: row.branch_labels,
    hash: row.hash,
    filePath: row.file_path,
    appliedAt: row.applied_at,
    executionOrder: row.execution_order,
    metadata: parseMetadata(row.metadata),
  }));
}

export async function insertAppliedRevision(
  client: Client,
  options: RunnerOptions,
  migration: Migration
): Promise<void> {
  await client.query(
    `
      INSERT INTO ${stateTableName(options)}
        (revision, down_revisions, branch_labels, hash, file_path, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      migration.revision,
      migration.downRevisions,
      migration.branchLabels,
      migration.hash,
      migration.filePath,
      JSON.stringify(migration.metadata ?? {}),
    ]
  );
}

export async function deleteAppliedRevision(
  client: Client,
  options: RunnerOptions,
  revision: string
): Promise<void> {
  await client.query(
    `DELETE FROM ${stateTableName(options)} WHERE revision = $1`,
    [revision]
  );
}

import type { Client, ClientConfig, QueryResult } from 'pg';

export type MigrationDirection = 'up' | 'down';

export interface Logger {
  debug?(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface MigrationDb {
  sql(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<QueryResult>;
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface MigrationDefinition {
  revision: string;
  downRevision?: string | readonly string[] | null;
  branchLabels?: readonly string[];
  metadata?: Record<string, unknown>;
  transaction?: boolean;
  up(db: MigrationDb): Promise<void> | void;
  down(db: MigrationDb): Promise<void> | void;
}

export interface Migration extends MigrationDefinition {
  downRevisions: readonly string[];
  branchLabels: readonly string[];
  filePath: string;
  hash: string;
}

export interface MigrationNode {
  migration: Migration;
  parents: readonly string[];
  children: readonly string[];
}

export interface MigrationGraph {
  nodes: ReadonlyMap<string, MigrationNode>;
  roots: readonly string[];
  heads: readonly string[];
  topological: readonly string[];
}

export interface AppliedRevision {
  revision: string;
  downRevisions: readonly string[];
  branchLabels: readonly string[];
  hash: string;
  filePath: string;
  appliedAt: Date;
  executionOrder: string;
  metadata: Record<string, unknown>;
}

export interface RunnerOptions {
  migrationsDir: string;
  databaseUrl?: string | ClientConfig;
  client?: Client;
  schema?: string;
  table?: string;
  searchPath?: string | readonly string[];
  lock?: boolean;
  lockKey?: number;
  logger?: Logger;
}

export interface MigrationRun {
  revision: string;
  direction: MigrationDirection;
  filePath: string;
}

export interface MigrationRunResult {
  direction: MigrationDirection;
  target: string;
  migrations: readonly MigrationRun[];
  currentHeads: readonly string[];
}

export interface CurrentResult {
  applied: readonly AppliedRevision[];
  currentHeads: readonly string[];
}

export interface HeadsResult {
  graphHeads: readonly string[];
  currentHeads: readonly string[];
}

export interface CheckResult {
  graph: MigrationGraph;
  migrations: readonly Migration[];
}

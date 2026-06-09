import { createJiti } from 'jiti';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { hashMigrationContent } from './hash.js';
import type { Logger, Migration, MigrationDefinition } from './types.js';

const migrationExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.mjs',
  '.mts',
  '.ts',
]);

const jiti = createJiti(process.cwd());

export interface LoadMigrationsOptions {
  migrationsDir: string;
  logger?: Logger;
}

async function walkMigrationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkMigrationFiles(fullPath)));
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    if (entry.name.endsWith('.d.ts')) {
      continue;
    }

    if (migrationExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return [...files].sort((a: string, b: string) => a.localeCompare(b));
}

function normalizeParents(
  revision: string,
  downRevision: MigrationDefinition['downRevision']
): readonly string[] {
  if (downRevision === undefined || downRevision === null) {
    return [];
  }

  const parents = Array.isArray(downRevision) ? downRevision : [downRevision];
  for (const parent of parents) {
    if (typeof parent !== 'string' || parent.trim().length === 0) {
      throw new Error(`Migration ${revision} has an invalid downRevision`);
    }
  }

  return [...new Set(parents)];
}

function normalizeLabels(
  revision: string,
  branchLabels: MigrationDefinition['branchLabels']
): readonly string[] {
  if (branchLabels === undefined) {
    return [];
  }

  if (!Array.isArray(branchLabels)) {
    throw new Error(`Migration ${revision} has an invalid branch label`);
  }

  for (const label of branchLabels) {
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new Error(`Migration ${revision} has an invalid branch label`);
    }
  }

  return [...new Set(branchLabels)];
}

function extractDefinition(
  loadedModule: unknown,
  filePath: string
): MigrationDefinition {
  const record =
    loadedModule && typeof loadedModule === 'object'
      ? (loadedModule as Record<string, unknown>)
      : undefined;
  const defaultExport = record?.default;
  const namedExport = record?.migration;
  const candidate = isMigrationCandidate(defaultExport)
    ? defaultExport
    : isMigrationCandidate(namedExport)
      ? namedExport
      : (defaultExport ?? namedExport ?? loadedModule);

  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Migration file ${filePath} did not export a migration`);
  }

  const migration = candidate as MigrationDefinition;
  if (
    typeof migration.revision !== 'string' ||
    migration.revision.trim().length === 0
  ) {
    throw new Error(`Migration file ${filePath} has no revision`);
  }

  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${migration.revision} has no up function`);
  }

  if (typeof migration.down !== 'function') {
    throw new Error(`Migration ${migration.revision} has no down function`);
  }

  return migration;
}

function isMigrationCandidate(value: unknown): value is MigrationDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'revision' in value || 'up' in value || 'down' in value;
}

export async function loadMigrations(
  options: LoadMigrationsOptions
): Promise<Migration[]> {
  const migrationsDir = resolve(options.migrationsDir);
  const filePaths = await walkMigrationFiles(migrationsDir);
  const migrations: Migration[] = [];

  for (const filePath of filePaths) {
    options.logger?.debug?.(`Loading migration ${filePath}`);
    const [loadedModule, content] = await Promise.all([
      jiti.import(filePath),
      readFile(filePath, 'utf8'),
    ]);
    const definition = extractDefinition(loadedModule, filePath);
    const downRevisions = normalizeParents(
      definition.revision,
      definition.downRevision
    );
    const branchLabels = normalizeLabels(
      definition.revision,
      definition.branchLabels
    );

    migrations.push({
      ...definition,
      downRevisions,
      branchLabels,
      filePath,
      hash: hashMigrationContent(content),
    });
  }

  return migrations;
}

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkMigrations,
  current,
  down,
  getHeads,
  type RunnerOptions,
  up,
} from '../../src/index.js';
import {
  connectionString,
  queryRows,
  resetSchema,
  startPostgres,
  stopPostgres,
} from './dockerPostgres.js';

const branchingDir = fileURLToPath(
  new URL('../fixtures/branching', import.meta.url)
);
const unmergedDir = fileURLToPath(
  new URL('../fixtures/unmerged', import.meta.url)
);

function options(schema: string, migrationsDir = branchingDir): RunnerOptions {
  return {
    migrationsDir,
    databaseUrl: connectionString,
    schema,
    searchPath: schema,
  };
}

async function labels(schema: string): Promise<string[]> {
  const rows = await queryRows<{ label: string }>(
    schema,
    'SELECT label FROM migration_events ORDER BY label'
  );
  return rows.map((row) => row.label);
}

async function relationExists(
  schema: string,
  relation: string
): Promise<boolean> {
  const rows = await queryRows<{ exists: boolean }>(
    schema,
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists
    `,
    [schema, relation]
  );
  return rows[0]?.exists ?? false;
}

describe('PostgreSQL DAG migrations', () => {
  beforeAll(async () => {
    await startPostgres();
  });

  afterAll(() => {
    stopPostgres();
  });

  beforeEach(async (context) => {
    await resetSchema(context.task.name.replaceAll(/\W+/g, '_').toLowerCase());
  });

  it('applies separate branches, merges them, and downgrades through the merge', async (context) => {
    const schema = context.task.name.replaceAll(/\W+/g, '_').toLowerCase();
    const runner = options(schema);

    await expect(checkMigrations(runner)).resolves.toMatchObject({
      graph: {
        heads: ['0003_merge_alpha_beta'],
      },
    });

    const alpha = await up(runner, '0002_alpha');
    expect(alpha.migrations.map((m) => m.revision)).toEqual([
      '0001_init',
      '0002_alpha',
    ]);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0002_alpha'],
    });
    await expect(labels(schema)).resolves.toEqual(['alpha', 'init']);
    await expect(relationExists(schema, 'alpha_feature')).resolves.toBe(true);
    await expect(relationExists(schema, 'beta_feature')).resolves.toBe(false);

    const beta = await up(runner, '0002_beta');
    expect(beta.migrations.map((m) => m.revision)).toEqual(['0002_beta']);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0002_alpha', '0002_beta'],
    });
    await expect(labels(schema)).resolves.toEqual(['alpha', 'beta', 'init']);

    const merge = await up(runner);
    expect(merge.migrations.map((m) => m.revision)).toEqual([
      '0003_merge_alpha_beta',
    ]);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0003_merge_alpha_beta'],
    });
    await expect(labels(schema)).resolves.toEqual([
      'alpha',
      'beta',
      'init',
      'merge',
    ]);
    await expect(relationExists(schema, 'merged_features')).resolves.toBe(true);

    const unmerge = await down(runner);
    expect(unmerge.migrations.map((m) => m.revision)).toEqual([
      '0003_merge_alpha_beta',
    ]);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0002_alpha', '0002_beta'],
    });
    await expect(labels(schema)).resolves.toEqual(['alpha', 'beta', 'init']);
    await expect(relationExists(schema, 'merged_features')).resolves.toBe(false);

    const toInit = await down(runner, '0001_init');
    expect(toInit.migrations.map((m) => m.revision)).toEqual([
      '0002_beta',
      '0002_alpha',
    ]);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0001_init'],
    });
    await expect(labels(schema)).resolves.toEqual(['init']);

    const toBase = await down(runner, 'base');
    expect(toBase.migrations.map((m) => m.revision)).toEqual(['0001_init']);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: [],
    });
  });

  it('requires explicit targets for unmerged branch heads', async (context) => {
    const schema = context.task.name.replaceAll(/\W+/g, '_').toLowerCase();
    const runner = options(schema, unmergedDir);

    await expect(getHeads(runner)).resolves.toEqual({
      graphHeads: ['0002_left', '0002_right'],
      currentHeads: [],
    });
    await expect(up(runner)).rejects.toThrow('Multiple graph heads');

    const result = await up(runner, 'heads');
    expect(result.migrations.map((m) => m.revision)).toEqual([
      '0001_init',
      '0002_left',
      '0002_right',
    ]);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0002_left', '0002_right'],
    });
    await expect(labels(schema)).resolves.toEqual(['init', 'left', 'right']);
    await expect(down(runner)).rejects.toThrow('Multiple current heads');

    const toInit = await down(runner, '0001_init');
    expect(toInit.migrations.map((m) => m.revision)).toEqual([
      '0002_right',
      '0002_left',
    ]);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0001_init'],
    });
  });

  it('fails when an applied migration file changes on disk', async (context) => {
    const schema = context.task.name.replaceAll(/\W+/g, '_').toLowerCase();
    const migrationsDir = await mkdtemp(join(tmpdir(), 'pg-branch-migrate-'));
    const sourceImport = pathToFileURL(
      fileURLToPath(new URL('../../src/index.ts', import.meta.url))
    ).href;
    await writeFile(
      join(migrationsDir, '001_init.ts'),
      `
        import { defineMigration } from ${JSON.stringify(sourceImport)};

        export default defineMigration({
          revision: '0001_init',
          downRevision: null,

          async up(db) {
            await db.sql\`CREATE TABLE migration_events (label text PRIMARY KEY)\`;
            await db.sql\`INSERT INTO migration_events(label) VALUES ('init')\`;
          },

          async down(db) {
            await db.sql\`DROP TABLE migration_events\`;
          },
        });
      `
    );
    const runner = options(schema, migrationsDir);

    await up(runner, '0001_init');
    await writeFile(
      join(migrationsDir, '001_init.ts'),
      "\n// changed after apply\n",
      { flag: 'a' }
    );

    await expect(current(runner)).rejects.toThrow(
      'Applied revision 0001_init has changed on disk'
    );
  });
});

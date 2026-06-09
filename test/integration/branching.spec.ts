import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  checkMigrations,
  current,
  down,
  getHeads,
  type RunnerOptions,
  up,
} from '../../src/index.js';
import { ensureStateTable, stateTableName } from '../../src/state.js';
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
const sourceImport = pathToFileURL(
  fileURLToPath(new URL('../../src/index.ts', import.meta.url))
).href;
const tempDirs: string[] = [];

function schemaName(context: { task: { name: string } }): string {
  const hash = createHash('sha1')
    .update(context.task.name)
    .digest('hex')
    .slice(0, 16);
  return `t_${hash}`;
}

function options(schema: string, migrationsDir = branchingDir): RunnerOptions {
  return {
    migrationsDir,
    databaseUrl: connectionString,
    schema,
    searchPath: schema,
  };
}

async function tempMigrations(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pg-branch-migrate-'));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const filePath = join(dir, file);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return dir;
}

function migrationSource(objectLiteral: string): string {
  return `
    import { defineMigration } from ${JSON.stringify(sourceImport)};

    export default defineMigration(${objectLiteral});
  `;
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
    await resetSchema(schemaName(context));
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it('applies separate branches, merges them, and downgrades through the merge', async (context) => {
    const schema = schemaName(context);
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
    const schema = schemaName(context);
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
    const schema = schemaName(context);
    const migrationsDir = await mkdtemp(join(tmpdir(), 'pg-branch-migrate-'));
    tempDirs.push(migrationsDir);
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

  it('rolls back a failed transactional up migration and keeps prior revisions applied', async (context) => {
    const schema = schemaName(context);
    const migrationsDir = await tempMigrations({
      '001_init.ts': migrationSource(`{
        revision: '0001_init',
        downRevision: null,

        async up(db) {
          await db.sql\`CREATE TABLE migration_events (label text PRIMARY KEY)\`;
          await db.sql\`INSERT INTO migration_events(label) VALUES ('init')\`;
        },

        async down(db) {
          await db.sql\`DROP TABLE migration_events\`;
        },
      }`),
      '002_fails.ts': migrationSource(`{
        revision: '0002_fails',
        downRevision: '0001_init',

        async up(db) {
          await db.sql\`CREATE TABLE failed_side_effect (id integer PRIMARY KEY)\`;
          throw new Error('boom up');
        },

        async down(db) {
          await db.sql\`DROP TABLE failed_side_effect\`;
        },
      }`),
    });
    const runner = options(schema, migrationsDir);

    await expect(up(runner)).rejects.toThrow('boom up');
    await expect(labels(schema)).resolves.toEqual(['init']);
    await expect(relationExists(schema, 'failed_side_effect')).resolves.toBe(
      false
    );
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0001_init'],
    });
  });

  it('does not mark a failed non-transactional migration as applied', async (context) => {
    const schema = schemaName(context);
    const migrationsDir = await tempMigrations({
      '001_non_transactional.ts': migrationSource(`{
        revision: '0001_non_transactional',
        downRevision: null,
        transaction: false,

        async up(db) {
          await db.sql\`CREATE TABLE non_transactional_side_effect (id integer PRIMARY KEY)\`;
          throw new Error('boom no transaction');
        },

        async down(db) {
          await db.sql\`DROP TABLE non_transactional_side_effect\`;
        },
      }`),
    });
    const runner = options(schema, migrationsDir);

    await expect(up(runner)).rejects.toThrow('boom no transaction');
    await expect(
      relationExists(schema, 'non_transactional_side_effect')
    ).resolves.toBe(true);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: [],
    });
  });

  it('rolls back a failed down migration and keeps the revision applied', async (context) => {
    const schema = schemaName(context);
    const migrationsDir = await tempMigrations({
      '001_init.ts': migrationSource(`{
        revision: '0001_init',
        downRevision: null,

        async up(db) {
          await db.sql\`CREATE TABLE migration_events (label text PRIMARY KEY)\`;
          await db.sql\`INSERT INTO migration_events(label) VALUES ('init')\`;
        },

        async down(db) {
          await db.sql\`DROP TABLE migration_events\`;
        },
      }`),
      '002_down_fails.ts': migrationSource(`{
        revision: '0002_down_fails',
        downRevision: '0001_init',

        async up(db) {
          await db.sql\`CREATE TABLE down_rollback_marker (id integer PRIMARY KEY)\`;
          await db.sql\`INSERT INTO migration_events(label) VALUES ('second')\`;
        },

        async down(db) {
          await db.sql\`DROP TABLE down_rollback_marker\`;
          await db.sql\`DELETE FROM migration_events WHERE label = 'second'\`;
          throw new Error('boom down');
        },
      }`),
    });
    const runner = options(schema, migrationsDir);

    await up(runner);
    await expect(down(runner)).rejects.toThrow('boom down');
    await expect(relationExists(schema, 'down_rollback_marker')).resolves.toBe(
      true
    );
    await expect(labels(schema)).resolves.toEqual(['init', 'second']);
    await expect(current(runner)).resolves.toMatchObject({
      currentHeads: ['0002_down_fails'],
    });
  });

  it('supports quoted custom schemas, custom state tables, and array search paths', async (context) => {
    const schema = `${schemaName(context)}-custom`;
    await resetSchema(schema);
    const migrationsDir = await tempMigrations({
      '001_probe.ts': migrationSource(`{
        revision: '0001_probe',
        downRevision: null,

        async up(db) {
          await db.sql\`CREATE TABLE search_path_probe (id integer PRIMARY KEY)\`;
        },

        async down(db) {
          await db.sql\`DROP TABLE search_path_probe\`;
        },
      }`),
    });
    const runner: RunnerOptions = {
      ...options(schema, migrationsDir),
      table: 'migration table',
      searchPath: [schema, 'public'],
    };

    await up(runner);

    await expect(relationExists(schema, 'search_path_probe')).resolves.toBe(
      true
    );
    await expect(
      queryRows<{ revision: string }>(
        schema,
        'SELECT revision FROM "migration table" ORDER BY execution_order'
      )
    ).resolves.toEqual([{ revision: '0001_probe' }]);
  });

  it('persists migration metadata, branch labels, and parent arrays', async (context) => {
    const schema = schemaName(context);
    const migrationsDir = await tempMigrations({
      '001_meta.ts': migrationSource(`{
        revision: '0001_meta',
        downRevision: null,
        branchLabels: ['metadata'],
        metadata: { ticket: 'DB-1', nested: { safe: true } },

        async up(db) {
          await db.sql\`CREATE TABLE metadata_probe (id integer PRIMARY KEY)\`;
        },

        async down(db) {
          await db.sql\`DROP TABLE metadata_probe\`;
        },
      }`),
    });
    const runner = options(schema, migrationsDir);

    await up(runner);
    const result = await current(runner);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toMatchObject({
      revision: '0001_meta',
      downRevisions: [],
      branchLabels: ['metadata'],
      metadata: { ticket: 'DB-1', nested: { safe: true } },
    });
  });

  it('rejects advisory lock contention and can run after the lock is released', async (context) => {
    const schema = schemaName(context);
    const lockKey = 891_001;
    const runner = options(schema);
    const client = new Client({ connectionString });
    await client.connect();

    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
      await expect(up({ ...runner, lockKey }, '0001_init')).rejects.toThrow(
        'Another migration run already holds the advisory lock'
      );
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);

      await expect(
        up({ ...runner, lockKey }, '0001_init')
      ).resolves.toMatchObject({
        currentHeads: ['0001_init'],
      });
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1)', [lockKey])
        .catch(() => undefined);
      await client.end();
    }
  });

  it('can disable advisory locking when the caller owns concurrency control', async (context) => {
    const schema = schemaName(context);
    const lockKey = 891_002;
    const client = new Client({ connectionString });
    await client.connect();

    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
      await expect(
        up({ ...options(schema), lock: false, lockKey }, '0001_init')
      ).resolves.toMatchObject({
        currentHeads: ['0001_init'],
      });
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1)', [lockKey])
        .catch(() => undefined);
      await client.end();
    }
  });

  it('uses an external pg client without closing it', async (context) => {
    const schema = schemaName(context);
    const client = new Client({ connectionString });
    await client.connect();

    try {
      await up(
        {
          ...options(schema),
          databaseUrl: undefined,
          client,
        },
        '0001_init'
      );

      const { rows } = await client.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows).toEqual([{ ok: 1 }]);
    } finally {
      await client.end();
    }
  });

  it('rejects unknown revisions already present in the state table', async (context) => {
    const schema = schemaName(context);
    const runner = options(schema);
    const client = new Client({ connectionString });
    await client.connect();

    try {
      await ensureStateTable(client, runner);
      await client.query(
        `
          INSERT INTO ${stateTableName(runner)}
            (revision, down_revisions, branch_labels, hash, file_path, metadata)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        ['ghost_revision', [], [], 'ghost_hash', 'ghost.ts', '{}']
      );
    } finally {
      await client.end();
    }

    await expect(current(runner)).rejects.toThrow(
      'Database contains unknown applied revision ghost_revision'
    );
  });

  it('returns a no-op run when the target revision is already applied', async (context) => {
    const schema = schemaName(context);
    const runner = options(schema);

    await up(runner, '0001_init');
    await expect(up(runner, '0001_init')).resolves.toMatchObject({
      migrations: [],
      currentHeads: ['0001_init'],
    });
  });
});

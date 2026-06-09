import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashMigrationContent } from '../../src/hash.js';
import { loadMigrations } from '../../src/loader.js';

const sourceImport = pathToFileURL(
  fileURLToPath(new URL('../../src/index.ts', import.meta.url))
).href;
const tempDirs: string[] = [];

async function tempMigrations(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pg-branch-migrate-loader-'));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const filePath = join(dir, file);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return dir;
}

function moduleSource(objectLiteral: string): string {
  return `
    import { defineMigration } from ${JSON.stringify(sourceImport)};

    export default defineMigration(${objectLiteral});
  `;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe('loadMigrations', () => {
  it('loads migrations recursively, ignores non-migration files, and normalizes metadata', async () => {
    const first = moduleSource(`{
      revision: '0001_init',
      downRevision: null,
      branchLabels: ['base', 'base'],
      metadata: { kind: 'schema' },
      async up() {},
      async down() {},
    }`);
    const second = moduleSource(`{
      revision: '0002_feature',
      downRevision: '0001_init',
      async up() {},
      async down() {},
    }`);
    const merge = moduleSource(`{
      revision: '0003_merge',
      downRevision: ['0002_feature', '0002_feature'],
      branchLabels: ['merge', 'merge'],
      async up() {},
      async down() {},
    }`);
    const logger = { debug: vi.fn() };
    const dir = await tempMigrations({
      '001_init.ts': first,
      'ignored.d.ts': 'export default {}',
      'ignored.sql': 'select 1',
      'nested/002_feature.ts': second,
      'nested/003_merge.ts': merge,
    });

    const migrations = await loadMigrations({ migrationsDir: dir, logger });

    expect(migrations.map((migration) => migration.revision)).toEqual([
      '0001_init',
      '0002_feature',
      '0003_merge',
    ]);
    expect(migrations[0]?.downRevisions).toEqual([]);
    expect(migrations[0]?.branchLabels).toEqual(['base']);
    expect(migrations[0]?.metadata).toEqual({ kind: 'schema' });
    expect(migrations[1]?.downRevisions).toEqual(['0001_init']);
    expect(migrations[2]?.downRevisions).toEqual(['0002_feature']);
    expect(migrations[2]?.branchLabels).toEqual(['merge']);
    expect(logger.debug).toHaveBeenCalledTimes(3);

    const content = await readFile(migrations[0]?.filePath ?? '', 'utf8');
    expect(migrations[0]?.hash).toBe(hashMigrationContent(content));
  });

  it('loads a named migration export when no default export exists', async () => {
    const dir = await tempMigrations({
      '001_named.ts': `
        import { defineMigration } from ${JSON.stringify(sourceImport)};

        export const migration = defineMigration({
          revision: '0001_named',
          async up() {},
          async down() {},
        });
      `,
    });

    await expect(loadMigrations({ migrationsDir: dir })).resolves.toMatchObject([
      {
        revision: '0001_named',
        downRevisions: [],
        branchLabels: [],
      },
    ]);
  });

  it('rejects files that do not export a migration object', async () => {
    const dir = await tempMigrations({ '001_bad.ts': 'export default 42;' });

    await expect(loadMigrations({ migrationsDir: dir })).rejects.toThrow(
      'did not export a migration'
    );
  });

  it('rejects missing or blank revisions', async () => {
    const missing = await tempMigrations({
      '001_missing.ts': 'export default { async up() {}, async down() {} };',
    });
    const blank = await tempMigrations({
      '001_blank.ts': moduleSource(`{
        revision: '   ',
        async up() {},
        async down() {},
      }`),
    });

    await expect(loadMigrations({ migrationsDir: missing })).rejects.toThrow(
      'has no revision'
    );
    await expect(loadMigrations({ migrationsDir: blank })).rejects.toThrow(
      'has no revision'
    );
  });

  it('rejects migrations missing up or down functions', async () => {
    const missingUp = await tempMigrations({
      '001_missing_up.ts': 'export default { revision: "0001", async down() {} };',
    });
    const missingDown = await tempMigrations({
      '001_missing_down.ts': 'export default { revision: "0001", async up() {} };',
    });

    await expect(loadMigrations({ migrationsDir: missingUp })).rejects.toThrow(
      'Migration 0001 has no up function'
    );
    await expect(loadMigrations({ migrationsDir: missingDown })).rejects.toThrow(
      'Migration 0001 has no down function'
    );
  });

  it('rejects invalid down revisions', async () => {
    const dir = await tempMigrations({
      '001_bad_parent.ts': moduleSource(`{
        revision: '0001_bad_parent',
        downRevision: [''],
        async up() {},
        async down() {},
      }`),
    });

    await expect(loadMigrations({ migrationsDir: dir })).rejects.toThrow(
      'Migration 0001_bad_parent has an invalid downRevision'
    );
  });

  it('rejects invalid branch labels', async () => {
    const blankLabel = await tempMigrations({
      '001_bad_label.ts': moduleSource(`{
        revision: '0001_bad_label',
        branchLabels: ['good', ''],
        async up() {},
        async down() {},
      }`),
    });
    const nonArrayLabel = await tempMigrations({
      '001_bad_label_shape.ts': moduleSource(`{
        revision: '0001_bad_label_shape',
        branchLabels: 'not-an-array',
        async up() {},
        async down() {},
      }`),
    });

    await expect(loadMigrations({ migrationsDir: blankLabel })).rejects.toThrow(
      'Migration 0001_bad_label has an invalid branch label'
    );
    await expect(
      loadMigrations({ migrationsDir: nonArrayLabel })
    ).rejects.toThrow(
      'Migration 0001_bad_label_shape has an invalid branch label'
    );
  });
});

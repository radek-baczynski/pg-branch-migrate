# pg-branch-migrate

Alembic-lite DAG migrations for PostgreSQL and TypeScript.

This first version is intentionally small:

- explicit revisions and parent revisions
- branch heads and merge migrations
- reversible `up` and `down` functions
- PostgreSQL advisory lock
- per-migration transactions by default
- migration file hashing
- Docker-backed integration tests against a real PostgreSQL database

It does not read or depend on Drizzle migration artifacts. In a Drizzle app, this package is meant to own database evolution and replace the migration runner, while Drizzle remains the ORM/query layer.

## Migration

```ts
import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '20260608_1030_add_accounts',
  downRevision: '20260601_0915_create_users',
  branchLabels: ['billing'],

  async up(db) {
    await db.sql`
      create table accounts (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now()
      )
    `;
  },

  async down(db) {
    await db.sql`drop table accounts`;
  },
});
```

Merge migrations use multiple parents:

```ts
export default defineMigration({
  revision: '20260608_1200_merge_billing_auth',
  downRevision: [
    '20260608_1030_add_accounts',
    '20260608_1100_add_sessions',
  ],
  async up() {},
  async down() {},
});
```

## CLI

```bash
pgm up --dir ./migrations
pgm up heads --dir ./migrations
pgm down -1 --dir ./migrations
pgm current --dir ./migrations
pgm heads --dir ./migrations
pgm history --dir ./migrations
pgm check --dir ./migrations
```

Connection defaults to `DATABASE_URL`.

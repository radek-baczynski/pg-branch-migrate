import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0001_create_users',
  downRevision: null,

  async up(db) {
    await db.sql`
      CREATE TABLE app_users (
        id bigserial PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  },

  async down(db) {
    await db.sql`DROP TABLE app_users`;
  },
});

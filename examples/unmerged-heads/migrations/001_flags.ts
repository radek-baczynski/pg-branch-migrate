import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0001_flags',
  downRevision: null,

  async up(db) {
    await db.sql`
      CREATE TABLE feature_flags (
        name text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false
      )
    `;
  },

  async down(db) {
    await db.sql`DROP TABLE feature_flags`;
  },
});

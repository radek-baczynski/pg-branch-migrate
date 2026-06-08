import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0001_accounts',
  downRevision: null,

  async up(db) {
    await db.sql`
      CREATE TABLE accounts (
        id bigserial PRIMARY KEY,
        name text NOT NULL
      )
    `;
  },

  async down(db) {
    await db.sql`DROP TABLE accounts`;
  },
});

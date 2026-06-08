import { defineMigration } from '../../../src/index.js';

export default defineMigration({
  revision: '0001_init',
  downRevision: null,

  async up(db) {
    await db.sql`CREATE TABLE migration_events (label text PRIMARY KEY)`;
    await db.sql`INSERT INTO migration_events(label) VALUES ('init')`;
  },

  async down(db) {
    await db.sql`DROP TABLE migration_events`;
  },
});

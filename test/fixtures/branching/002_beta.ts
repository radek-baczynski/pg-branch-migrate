import { defineMigration } from '../../../src/index.js';

export default defineMigration({
  revision: '0002_beta',
  downRevision: '0001_init',
  branchLabels: ['beta'],

  async up(db) {
    await db.sql`CREATE TABLE beta_feature (id integer PRIMARY KEY)`;
    await db.sql`INSERT INTO migration_events(label) VALUES ('beta')`;
  },

  async down(db) {
    await db.sql`DROP TABLE beta_feature`;
    await db.sql`DELETE FROM migration_events WHERE label = 'beta'`;
  },
});

import { defineMigration } from '../../../src/index.js';

export default defineMigration({
  revision: '0002_alpha',
  downRevision: '0001_init',
  branchLabels: ['alpha'],

  async up(db) {
    await db.sql`CREATE TABLE alpha_feature (id integer PRIMARY KEY)`;
    await db.sql`INSERT INTO migration_events(label) VALUES ('alpha')`;
  },

  async down(db) {
    await db.sql`DROP TABLE alpha_feature`;
    await db.sql`DELETE FROM migration_events WHERE label = 'alpha'`;
  },
});

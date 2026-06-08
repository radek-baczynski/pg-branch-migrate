import { defineMigration } from '../../../src/index.js';

export default defineMigration({
  revision: '0002_left',
  downRevision: '0001_init',
  branchLabels: ['left'],

  async up(db) {
    await db.sql`INSERT INTO migration_events(label) VALUES ('left')`;
  },

  async down(db) {
    await db.sql`DELETE FROM migration_events WHERE label = 'left'`;
  },
});

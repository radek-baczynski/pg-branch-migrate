import { defineMigration } from '../../../src/index.js';

export default defineMigration({
  revision: '0002_right',
  downRevision: '0001_init',
  branchLabels: ['right'],

  async up(db) {
    await db.sql`INSERT INTO migration_events(label) VALUES ('right')`;
  },

  async down(db) {
    await db.sql`DELETE FROM migration_events WHERE label = 'right'`;
  },
});

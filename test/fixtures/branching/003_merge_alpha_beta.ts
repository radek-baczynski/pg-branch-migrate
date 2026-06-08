import { defineMigration } from '../../../src/index.js';

export default defineMigration({
  revision: '0003_merge_alpha_beta',
  downRevision: ['0002_alpha', '0002_beta'],

  async up(db) {
    await db.sql`
      CREATE VIEW merged_features AS
      SELECT 'alpha'::text AS branch
      UNION ALL
      SELECT 'beta'::text AS branch
    `;
    await db.sql`INSERT INTO migration_events(label) VALUES ('merge')`;
  },

  async down(db) {
    await db.sql`DROP VIEW merged_features`;
    await db.sql`DELETE FROM migration_events WHERE label = 'merge'`;
  },
});

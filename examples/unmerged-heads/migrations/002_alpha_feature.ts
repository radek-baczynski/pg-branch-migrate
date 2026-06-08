import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0002_alpha_feature',
  downRevision: '0001_flags',
  branchLabels: ['alpha'],

  async up(db) {
    await db.sql`
      INSERT INTO feature_flags(name, enabled)
      VALUES ('alpha_feature', true)
    `;
  },

  async down(db) {
    await db.sql`DELETE FROM feature_flags WHERE name = 'alpha_feature'`;
  },
});

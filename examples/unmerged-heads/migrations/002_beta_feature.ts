import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0002_beta_feature',
  downRevision: '0001_flags',
  branchLabels: ['beta'],

  async up(db) {
    await db.sql`
      INSERT INTO feature_flags(name, enabled)
      VALUES ('beta_feature', false)
    `;
  },

  async down(db) {
    await db.sql`DELETE FROM feature_flags WHERE name = 'beta_feature'`;
  },
});

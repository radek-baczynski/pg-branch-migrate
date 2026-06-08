import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0002_audit',
  downRevision: '0001_accounts',
  branchLabels: ['audit'],

  async up(db) {
    await db.sql`
      CREATE TABLE account_audit_log (
        id bigserial PRIMARY KEY,
        account_id bigint NOT NULL REFERENCES accounts(id),
        event text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  },

  async down(db) {
    await db.sql`DROP TABLE account_audit_log`;
  },
});

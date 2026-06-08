import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0003_merge_billing_audit',
  downRevision: ['0002_billing', '0002_audit'],

  async up(db) {
    await db.sql`
      CREATE VIEW account_activity AS
      SELECT account_id, created_at, 'invoice'::text AS kind FROM invoices
      UNION ALL
      SELECT account_id, created_at, event AS kind FROM account_audit_log
    `;
  },

  async down(db) {
    await db.sql`DROP VIEW account_activity`;
  },
});

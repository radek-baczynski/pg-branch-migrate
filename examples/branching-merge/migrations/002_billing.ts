import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0002_billing',
  downRevision: '0001_accounts',
  branchLabels: ['billing'],

  async up(db) {
    await db.sql`
      CREATE TABLE invoices (
        id bigserial PRIMARY KEY,
        account_id bigint NOT NULL REFERENCES accounts(id),
        total_cents integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  },

  async down(db) {
    await db.sql`DROP TABLE invoices`;
  },
});

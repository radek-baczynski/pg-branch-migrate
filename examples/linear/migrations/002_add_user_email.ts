import { defineMigration } from 'pg-branch-migrate';

export default defineMigration({
  revision: '0002_add_user_email',
  downRevision: '0001_create_users',

  async up(db) {
    await db.sql`ALTER TABLE app_users ADD COLUMN email text`;
    await db.sql`CREATE UNIQUE INDEX app_users_email_key ON app_users(email)`;
  },

  async down(db) {
    await db.sql`DROP INDEX app_users_email_key`;
    await db.sql`ALTER TABLE app_users DROP COLUMN email`;
  },
});

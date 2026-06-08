# Linear Example

A simple one-head migration chain:

```text
0001_create_users -> 0002_add_user_email
```

Run:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm run build
node dist/cli.js up --dir examples/linear/migrations --schema pgm_example_linear --search-path pgm_example_linear
node dist/cli.js current --dir examples/linear/migrations --schema pgm_example_linear
node dist/cli.js down -1 --dir examples/linear/migrations --schema pgm_example_linear --search-path pgm_example_linear
```


# Branching Merge Example

Two independent branches start from the same base revision, then a merge revision joins them:

```text
                 0002_billing
                /            \
0001_accounts --              -> 0003_merge_billing_audit
                \            /
                 0002_audit
```

Run one branch, then the other, then the merge:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm run build
node dist/cli.js up 0002_billing --dir examples/branching-merge/migrations --schema pgm_example_branching --search-path pgm_example_branching
node dist/cli.js up 0002_audit --dir examples/branching-merge/migrations --schema pgm_example_branching --search-path pgm_example_branching
node dist/cli.js current --dir examples/branching-merge/migrations --schema pgm_example_branching
node dist/cli.js up --dir examples/branching-merge/migrations --schema pgm_example_branching --search-path pgm_example_branching
node dist/cli.js down -1 --dir examples/branching-merge/migrations --schema pgm_example_branching --search-path pgm_example_branching
```

After `down -1`, the merge revision is removed and the two branch heads are current again.


# Unmerged Heads Example

This graph intentionally has two heads and no merge revision:

```text
              0002_alpha_feature
             /
0001_flags --
             \
              0002_beta_feature
```

Default `up` is ambiguous and will fail. Use `heads` to apply both:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm run build
node dist/cli.js heads --dir examples/unmerged-heads/migrations --schema pgm_example_unmerged
node dist/cli.js up --dir examples/unmerged-heads/migrations --schema pgm_example_unmerged --search-path pgm_example_unmerged
node dist/cli.js up heads --dir examples/unmerged-heads/migrations --schema pgm_example_unmerged --search-path pgm_example_unmerged
node dist/cli.js down -1 --dir examples/unmerged-heads/migrations --schema pgm_example_unmerged --search-path pgm_example_unmerged
node dist/cli.js down 0001_flags --dir examples/unmerged-heads/migrations --schema pgm_example_unmerged --search-path pgm_example_unmerged
```

The plain `up` and `down -1` commands demonstrate ambiguity errors when multiple heads are present.


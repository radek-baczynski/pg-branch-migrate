# Examples

Each example is self-contained and uses migration files that import the package API:

```ts
import { defineMigration } from 'pg-branch-migrate';
```

Build the package first when running examples from this repository:

```bash
npm run build
```

Then point `pgm` at one example's `migrations` directory.

The commands below use isolated PostgreSQL schemas so examples can share one database.

You can also run every example against a disposable Docker PostgreSQL instance:

```bash
npm run examples
```

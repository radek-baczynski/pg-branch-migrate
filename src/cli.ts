#!/usr/bin/env node

import {
  checkMigrations,
  current,
  down,
  getHeads,
  getHistory,
  up,
} from './index.js';
import type { RunnerOptions } from './types.js';

interface ParsedArgs {
  command: string | undefined;
  target: string | undefined;
  options: Record<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    if (arg.startsWith('--no-')) {
      options[arg.slice('--no-'.length)] = false;
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }

  return {
    command: positional[0],
    target: positional[1],
    options,
  };
}

function stringOption(
  options: Record<string, string | boolean>,
  key: string
): string | undefined {
  const value = options[key];
  return typeof value === 'string' ? value : undefined;
}

function runnerOptions(parsed: ParsedArgs): RunnerOptions {
  const migrationsDir = stringOption(parsed.options, 'dir') ?? 'migrations';
  const databaseUrl =
    stringOption(parsed.options, 'database-url') ?? process.env.DATABASE_URL;

  if (!databaseUrl && parsed.command !== 'check' && parsed.command !== 'history') {
    throw new Error(
      'Database URL is required. Set DATABASE_URL or pass --database-url.'
    );
  }

  return {
    migrationsDir,
    databaseUrl,
    schema: stringOption(parsed.options, 'schema'),
    table: stringOption(parsed.options, 'table'),
    searchPath: stringOption(parsed.options, 'search-path'),
    lock: parsed.options.lock === false ? false : undefined,
    logger: console,
  };
}

function printHelp(): void {
  console.log(`Usage: pgm <command> [target] [options]

Commands:
  up [head|heads|revision]       Apply migrations
  down [-1|base|revision]        Roll back migrations
  current                        Print currently applied heads
  heads                          Print graph heads and current heads
  history                        Print migration graph in topological order
  check                          Validate migration graph

Options:
  --dir <path>                   Migration directory (default: migrations)
  --database-url <url>           PostgreSQL connection URL (default: DATABASE_URL)
  --schema <schema>              State table schema (default: public)
  --table <table>                State table name (default: pg_migration_revisions)
  --search-path <schema>         Search path used while running migration SQL
  --no-lock                      Disable advisory lock
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
    printHelp();
    return;
  }

  const options = runnerOptions(parsed);

  switch (parsed.command) {
    case 'up': {
      const result = await up(options, parsed.target ?? 'head');
      console.log(
        `Applied ${result.migrations.length} migration(s). Current heads: ${result.currentHeads.join(', ') || '(base)'}`
      );
      break;
    }

    case 'down': {
      const result = await down(options, parsed.target ?? '-1');
      console.log(
        `Rolled back ${result.migrations.length} migration(s). Current heads: ${result.currentHeads.join(', ') || '(base)'}`
      );
      break;
    }

    case 'current': {
      const result = await current(options);
      console.log(result.currentHeads.join('\n') || '(base)');
      break;
    }

    case 'heads': {
      const result = await getHeads(options);
      console.log(`Graph heads:\n${result.graphHeads.join('\n') || '(none)'}`);
      console.log(
        `Current heads:\n${result.currentHeads.join('\n') || '(base)'}`
      );
      break;
    }

    case 'history': {
      const migrations = await getHistory(options);
      for (const migration of migrations) {
        console.log(
          `${migration.revision} <- ${migration.downRevisions.join(', ') || '(base)'}`
        );
      }
      break;
    }

    case 'check': {
      const result = await checkMigrations(options);
      console.log(
        `OK: ${result.migrations.length} migration(s), ${result.graph.heads.length} graph head(s)`
      );
      break;
    }

    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

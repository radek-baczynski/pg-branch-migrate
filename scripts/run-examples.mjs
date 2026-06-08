#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const { Client } = pg;

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const containerName = `pg-branch-migrate-examples-${process.pid}-${Date.now()}`;
const databaseName = 'pg_branch_migrate_examples';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let containerStarted = false;
let connectionString;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function docker(args) {
  return execFileSync('docker', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function dockerIgnore(args) {
  try {
    docker(args);
  } catch {
    // Best-effort cleanup for interrupted or partially started runs.
  }
}

function cliArgs(args) {
  return ['dist/cli.js', ...args, '--database-url', connectionString];
}

function runCli(args) {
  run('node', cliArgs(args));
}

function expectCliFailure(args, expectedText) {
  const result = spawnSync('node', cliArgs(args), {
    cwd: rootDir,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();

  if (result.status === 0) {
    throw new Error(`Expected command to fail: node ${cliArgs(args).join(' ')}`);
  }

  if (!output.includes(expectedText)) {
    throw new Error(
      `Expected failure output to include ${JSON.stringify(
        expectedText
      )}, got:\n${output}`
    );
  }

  console.log(output);
}

function commonArgs(exampleDir, schema) {
  return [
    '--dir',
    `examples/${exampleDir}/migrations`,
    '--schema',
    schema,
    '--search-path',
    schema,
  ];
}

async function waitForPostgres() {
  const deadline = Date.now() + 90_000;
  let lastError;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await delay(1_000);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Timed out waiting for PostgreSQL');
}

function startPostgres() {
  docker([
    'run',
    '--rm',
    '--name',
    containerName,
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    `POSTGRES_DB=${databaseName}`,
    '-p',
    '127.0.0.1::5432',
    '-d',
    'postgres:16-alpine',
  ]);
  containerStarted = true;

  const portOutput = docker(['port', containerName, '5432/tcp']).trim();
  const port = portOutput.match(/:(\d+)$/)?.[1];

  if (!port) {
    throw new Error(`Could not parse Docker port output: ${portOutput}`);
  }

  connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/${databaseName}`;
  console.log(`Started ${containerName} on PostgreSQL port ${port}`);
}

function runLinearExample() {
  console.log('\n== linear ==');
  const args = commonArgs('linear', 'pgm_example_linear');

  runCli(['check', '--dir', 'examples/linear/migrations']);
  runCli(['up', ...args]);
  runCli(['current', ...args]);
  runCli(['down', 'base', ...args]);
}

function runBranchingMergeExample() {
  console.log('\n== branching-merge ==');
  const args = commonArgs('branching-merge', 'pgm_example_branching');

  runCli(['check', '--dir', 'examples/branching-merge/migrations']);
  runCli(['up', '0002_billing', ...args]);
  runCli(['up', '0002_audit', ...args]);
  runCli(['current', ...args]);
  runCli(['up', ...args]);
  runCli(['down', '-1', ...args]);
  runCli(['down', 'base', ...args]);
}

function runUnmergedHeadsExample() {
  console.log('\n== unmerged-heads ==');
  const args = commonArgs('unmerged-heads', 'pgm_example_unmerged');

  runCli(['check', '--dir', 'examples/unmerged-heads/migrations']);
  runCli(['heads', ...args]);
  expectCliFailure(['up', ...args], 'Multiple graph heads');
  runCli(['up', 'heads', ...args]);
  runCli(['current', ...args]);
  expectCliFailure(['down', '-1', ...args], 'Multiple current heads');
  runCli(['down', '0001_flags', ...args]);
  runCli(['down', 'base', ...args]);
}

async function main() {
  console.log('Building package');
  run(npmCommand, ['run', 'build']);

  try {
    startPostgres();
    await waitForPostgres();

    runLinearExample();
    runBranchingMergeExample();
    runUnmergedHeadsExample();

    console.log('\nAll examples completed successfully.');
  } finally {
    if (containerStarted) {
      console.log(`Stopping ${containerName}`);
      dockerIgnore(['rm', '-f', containerName]);
    }
  }
}

await main();

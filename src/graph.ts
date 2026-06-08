import type { AppliedRevision, Migration, MigrationGraph } from './types.js';

function byMigrationPath(
  migrationsByRevision: ReadonlyMap<string, Migration>,
  a: string,
  b: string
): number {
  const left = migrationsByRevision.get(a);
  const right = migrationsByRevision.get(b);

  return (
    (left?.filePath ?? a).localeCompare(right?.filePath ?? b) ||
    a.localeCompare(b)
  );
}

export function buildMigrationGraph(
  migrations: readonly Migration[]
): MigrationGraph {
  const migrationsByRevision = new Map<string, Migration>();

  for (const migration of migrations) {
    if (migrationsByRevision.has(migration.revision)) {
      throw new Error(`Duplicate migration revision: ${migration.revision}`);
    }

    migrationsByRevision.set(migration.revision, migration);
  }

  const childrenByRevision = new Map<string, string[]>();
  const parentCount = new Map<string, number>();

  for (const migration of migrations) {
    childrenByRevision.set(migration.revision, []);
    parentCount.set(migration.revision, migration.downRevisions.length);
  }

  for (const migration of migrations) {
    for (const parent of migration.downRevisions) {
      if (!migrationsByRevision.has(parent)) {
        throw new Error(
          `Migration ${migration.revision} references missing parent ${parent}`
        );
      }

      childrenByRevision.get(parent)?.push(migration.revision);
    }
  }

  for (const children of childrenByRevision.values()) {
    children.sort((a, b) => byMigrationPath(migrationsByRevision, a, b));
  }

  const queue = [...parentCount.entries()]
    .filter(([, count]) => count === 0)
    .map(([revision]) => revision)
    .sort((a: string, b: string) =>
      byMigrationPath(migrationsByRevision, a, b)
    );
  const topological: string[] = [];

  while (queue.length > 0) {
    const revision = queue.shift();
    if (revision === undefined) {
      break;
    }

    topological.push(revision);

    for (const child of childrenByRevision.get(revision) ?? []) {
      const nextCount = (parentCount.get(child) ?? 0) - 1;
      parentCount.set(child, nextCount);

      if (nextCount === 0) {
        queue.push(child);
        queue.sort((a: string, b: string) =>
          byMigrationPath(migrationsByRevision, a, b)
        );
      }
    }
  }

  if (topological.length !== migrations.length) {
    throw new Error('Migration graph contains a cycle');
  }

  const nodes = new Map(
    migrations.map((migration) => [
      migration.revision,
      {
        migration,
        parents: migration.downRevisions,
        children: childrenByRevision.get(migration.revision) ?? [],
      },
    ])
  );
  const roots = topological.filter(
    (revision) => nodes.get(revision)?.parents.length === 0
  );
  const heads = topological.filter(
    (revision) => nodes.get(revision)?.children.length === 0
  );

  return {
    nodes,
    roots,
    heads,
    topological,
  };
}

export function getAncestorsInclusive(
  graph: MigrationGraph,
  revision: string
): Set<string> {
  const ancestors = new Set<string>();

  function visit(current: string): void {
    if (ancestors.has(current)) {
      return;
    }

    const node = graph.nodes.get(current);
    if (!node) {
      throw new Error(`Unknown revision: ${current}`);
    }

    ancestors.add(current);
    for (const parent of node.parents) {
      visit(parent);
    }
  }

  visit(revision);
  return ancestors;
}

export function getCurrentHeads(
  graph: MigrationGraph,
  appliedRevisions: ReadonlySet<string>
): readonly string[] {
  return graph.topological.filter((revision) => {
    if (!appliedRevisions.has(revision)) {
      return false;
    }

    const node = graph.nodes.get(revision);
    return (node?.children ?? []).every((child) => !appliedRevisions.has(child));
  });
}

export function hasBranchLabelInAncestry(
  graph: MigrationGraph,
  revision: string,
  label: string
): boolean {
  const ancestors = getAncestorsInclusive(graph, revision);

  for (const ancestor of ancestors) {
    const node = graph.nodes.get(ancestor);
    if (node?.migration.branchLabels.includes(label)) {
      return true;
    }
  }

  return false;
}

export function validateAppliedRevisions(
  graph: MigrationGraph,
  applied: readonly AppliedRevision[]
): void {
  const seen = new Set<string>();

  for (const row of applied) {
    if (seen.has(row.revision)) {
      throw new Error(`Applied revision ${row.revision} appears more than once`);
    }

    seen.add(row.revision);
    const node = graph.nodes.get(row.revision);
    if (!node) {
      throw new Error(
        `Database contains unknown applied revision ${row.revision}`
      );
    }

    if (node.migration.hash !== row.hash) {
      throw new Error(`Applied revision ${row.revision} has changed on disk`);
    }
  }

  for (const row of applied) {
    const node = graph.nodes.get(row.revision);
    for (const parent of node?.parents ?? []) {
      if (!seen.has(parent)) {
        throw new Error(
          `Applied revision ${row.revision} is missing applied parent ${parent}`
        );
      }
    }
  }
}

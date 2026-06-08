import {
  getAncestorsInclusive,
  getCurrentHeads,
  hasBranchLabelInAncestry,
} from './graph.js';
import type { Migration, MigrationGraph } from './types.js';

function resolveUpTargets(
  graph: MigrationGraph,
  target: string | undefined
): readonly string[] {
  if (target === undefined || target === '' || target === 'head') {
    if (graph.heads.length !== 1) {
      throw new Error(
        `Multiple graph heads found (${graph.heads.join(
          ', '
        )}); use "heads" or a specific revision`
      );
    }

    return graph.heads;
  }

  if (target === 'heads') {
    return graph.heads;
  }

  if (target.endsWith('@head')) {
    const label = target.slice(0, -'@head'.length);
    const labeledHeads = graph.heads.filter((head) =>
      hasBranchLabelInAncestry(graph, head, label)
    );

    if (labeledHeads.length === 0) {
      throw new Error(`No graph head found for branch label ${label}`);
    }

    if (labeledHeads.length > 1) {
      throw new Error(
        `Multiple graph heads found for branch label ${label}: ${labeledHeads.join(
          ', '
        )}`
      );
    }

    return labeledHeads;
  }

  if (!graph.nodes.has(target)) {
    throw new Error(`Unknown target revision: ${target}`);
  }

  return [target];
}

export function planUp(
  graph: MigrationGraph,
  appliedRevisions: ReadonlySet<string>,
  target?: string
): readonly Migration[] {
  const targetRevisions = resolveUpTargets(graph, target);
  const required = new Set<string>();

  for (const revision of targetRevisions) {
    for (const ancestor of getAncestorsInclusive(graph, revision)) {
      required.add(ancestor);
    }
  }

  return graph.topological
    .filter((revision) => required.has(revision))
    .filter((revision) => !appliedRevisions.has(revision))
    .map((revision) => {
      const node = graph.nodes.get(revision);
      if (!node) {
        throw new Error(`Unknown revision in plan: ${revision}`);
      }

      return node.migration;
    });
}

export function planDown(
  graph: MigrationGraph,
  appliedRevisions: ReadonlySet<string>,
  target = '-1'
): readonly Migration[] {
  if (appliedRevisions.size === 0) {
    return [];
  }

  if (target === '-1') {
    const currentHeads = getCurrentHeads(graph, appliedRevisions);

    if (currentHeads.length !== 1) {
      throw new Error(
        `Multiple current heads found (${currentHeads.join(
          ', '
        )}); choose a target revision`
      );
    }

    const node = graph.nodes.get(currentHeads[0]);
    if (!node) {
      throw new Error(`Unknown current head: ${currentHeads[0]}`);
    }

    return [node.migration];
  }

  const desired = new Set<string>();
  if (target !== 'base') {
    if (!graph.nodes.has(target)) {
      throw new Error(`Unknown target revision: ${target}`);
    }

    if (!appliedRevisions.has(target)) {
      throw new Error(`Cannot downgrade to unapplied revision ${target}`);
    }

    for (const ancestor of getAncestorsInclusive(graph, target)) {
      desired.add(ancestor);
    }
  }

  const toRemove = new Set(
    [...appliedRevisions].filter((revision) => !desired.has(revision))
  );

  return [...graph.topological]
    .filter((revision) => toRemove.has(revision))
    .reverse()
    .map((revision) => {
      const node = graph.nodes.get(revision);
      if (!node) {
        throw new Error(`Unknown revision in plan: ${revision}`);
      }

      return node.migration;
    });
}

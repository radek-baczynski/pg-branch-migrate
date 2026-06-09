import { describe, expect, it } from 'vitest';
import {
  buildMigrationGraph,
  getAncestorsInclusive,
  getCurrentHeads,
  hasBranchLabelInAncestry,
  validateAppliedRevisions,
} from '../../src/graph.js';
import type { AppliedRevision, Migration } from '../../src/types.js';

function migration(
  revision: string,
  parents: readonly string[] = [],
  options: {
    branchLabels?: readonly string[];
    filePath?: string;
    hash?: string;
  } = {}
): Migration {
  return {
    revision,
    downRevision:
      parents.length === 0 ? null : parents.length === 1 ? parents[0] : parents,
    downRevisions: parents,
    branchLabels: options.branchLabels ?? [],
    filePath: options.filePath ?? `/migrations/${revision}.ts`,
    hash: options.hash ?? `hash:${revision}`,
    async up() {},
    async down() {},
  };
}

function applied(migration: Migration): AppliedRevision {
  return {
    revision: migration.revision,
    downRevisions: migration.downRevisions,
    branchLabels: migration.branchLabels,
    hash: migration.hash,
    filePath: migration.filePath,
    appliedAt: new Date('2026-06-08T00:00:00.000Z'),
    executionOrder: '1',
    metadata: {},
  };
}

function branchingMigrations(): Migration[] {
  return [
    migration('0002_beta', ['0001_init'], {
      branchLabels: ['beta'],
      filePath: '/migrations/003_beta.ts',
    }),
    migration('0003_merge', ['0002_alpha', '0002_beta'], {
      filePath: '/migrations/004_merge.ts',
    }),
    migration('0001_init', [], { filePath: '/migrations/001_init.ts' }),
    migration('0002_alpha', ['0001_init'], {
      branchLabels: ['alpha'],
      filePath: '/migrations/002_alpha.ts',
    }),
  ];
}

describe('buildMigrationGraph', () => {
  it('builds a deterministic DAG from unordered migrations', () => {
    const graph = buildMigrationGraph(branchingMigrations());

    expect(graph.roots).toEqual(['0001_init']);
    expect(graph.heads).toEqual(['0003_merge']);
    expect(graph.topological).toEqual([
      '0001_init',
      '0002_alpha',
      '0002_beta',
      '0003_merge',
    ]);
    expect(graph.nodes.get('0001_init')?.children).toEqual([
      '0002_alpha',
      '0002_beta',
    ]);
    expect(graph.nodes.get('0003_merge')?.parents).toEqual([
      '0002_alpha',
      '0002_beta',
    ]);
  });

  it('allows multiple roots and reports each independent head', () => {
    const graph = buildMigrationGraph([
      migration('root_b', [], { filePath: '/migrations/002_root_b.ts' }),
      migration('root_a', [], { filePath: '/migrations/001_root_a.ts' }),
    ]);

    expect(graph.roots).toEqual(['root_a', 'root_b']);
    expect(graph.heads).toEqual(['root_a', 'root_b']);
    expect(graph.topological).toEqual(['root_a', 'root_b']);
  });

  it('rejects duplicate revisions', () => {
    expect(() =>
      buildMigrationGraph([migration('0001'), migration('0001')])
    ).toThrow('Duplicate migration revision: 0001');
  });

  it('rejects missing parent references', () => {
    expect(() =>
      buildMigrationGraph([migration('0002', ['missing'])])
    ).toThrow('Migration 0002 references missing parent missing');
  });

  it('rejects cycles', () => {
    expect(() =>
      buildMigrationGraph([
        migration('0001', ['0002']),
        migration('0002', ['0001']),
      ])
    ).toThrow('Migration graph contains a cycle');
  });
});

describe('graph traversal helpers', () => {
  it('collects ancestors through merge parents', () => {
    const graph = buildMigrationGraph(branchingMigrations());

    expect([...getAncestorsInclusive(graph, '0003_merge')].sort()).toEqual([
      '0001_init',
      '0002_alpha',
      '0002_beta',
      '0003_merge',
    ]);
  });

  it('throws when collecting ancestors for an unknown revision', () => {
    const graph = buildMigrationGraph(branchingMigrations());

    expect(() => getAncestorsInclusive(graph, 'missing')).toThrow(
      'Unknown revision: missing'
    );
  });

  it('returns only applied revisions without applied children as current heads', () => {
    const graph = buildMigrationGraph(branchingMigrations());

    expect(
      getCurrentHeads(graph, new Set(['0001_init', '0002_alpha']))
    ).toEqual(['0002_alpha']);
    expect(
      getCurrentHeads(
        graph,
        new Set(['0001_init', '0002_alpha', '0002_beta'])
      )
    ).toEqual(['0002_alpha', '0002_beta']);
  });

  it('finds branch labels inherited through ancestry', () => {
    const graph = buildMigrationGraph(branchingMigrations());

    expect(hasBranchLabelInAncestry(graph, '0003_merge', 'alpha')).toBe(true);
    expect(hasBranchLabelInAncestry(graph, '0003_merge', 'beta')).toBe(true);
    expect(hasBranchLabelInAncestry(graph, '0003_merge', 'missing')).toBe(
      false
    );
  });
});

describe('validateAppliedRevisions', () => {
  it('accepts a complete applied ancestry with matching hashes', () => {
    const migrations = branchingMigrations();
    const graph = buildMigrationGraph(migrations);

    expect(() =>
      validateAppliedRevisions(graph, [
        applied(migrations[2]),
        applied(migrations[3]),
      ])
    ).not.toThrow();
  });

  it('rejects duplicate applied rows', () => {
    const migrations = branchingMigrations();
    const graph = buildMigrationGraph(migrations);

    expect(() =>
      validateAppliedRevisions(graph, [
        applied(migrations[2]),
        applied(migrations[2]),
      ])
    ).toThrow('Applied revision 0001_init appears more than once');
  });

  it('rejects unknown applied revisions', () => {
    const migrations = branchingMigrations();
    const graph = buildMigrationGraph(migrations);
    const unknown = applied(migration('unknown'));

    expect(() => validateAppliedRevisions(graph, [unknown])).toThrow(
      'Database contains unknown applied revision unknown'
    );
  });

  it('rejects hash drift for applied migrations', () => {
    const migrations = branchingMigrations();
    const graph = buildMigrationGraph(migrations);

    expect(() =>
      validateAppliedRevisions(graph, [
        { ...applied(migrations[2]), hash: 'changed' },
      ])
    ).toThrow('Applied revision 0001_init has changed on disk');
  });

  it('rejects an applied child when its parent is missing', () => {
    const migrations = branchingMigrations();
    const graph = buildMigrationGraph(migrations);

    expect(() =>
      validateAppliedRevisions(graph, [applied(migrations[3])])
    ).toThrow('Applied revision 0002_alpha is missing applied parent 0001_init');
  });
});

import { describe, expect, it } from 'vitest';
import { buildMigrationGraph } from '../../src/graph.js';
import { planDown, planUp } from '../../src/planner.js';
import type { Migration, MigrationGraph } from '../../src/types.js';

function migration(
  revision: string,
  parents: readonly string[] = [],
  branchLabels: readonly string[] = []
): Migration {
  return {
    revision,
    downRevision:
      parents.length === 0 ? null : parents.length === 1 ? parents[0] : parents,
    downRevisions: parents,
    branchLabels,
    filePath: `/migrations/${revision}.ts`,
    hash: `hash:${revision}`,
    async up() {},
    async down() {},
  };
}

function revisions(plan: readonly Migration[]): string[] {
  return plan.map((migration) => migration.revision);
}

function mergedGraph(): MigrationGraph {
  return buildMigrationGraph([
    migration('0001_init'),
    migration('0002_alpha', ['0001_init'], ['alpha']),
    migration('0002_beta', ['0001_init'], ['beta']),
    migration('0003_merge', ['0002_alpha', '0002_beta']),
  ]);
}

function unmergedGraph(): MigrationGraph {
  return buildMigrationGraph([
    migration('0001_init', [], ['base']),
    migration('0002_left', ['0001_init'], ['left']),
    migration('0002_right', ['0001_init'], ['right']),
  ]);
}

describe('planUp', () => {
  it('plans the full path to the single graph head by default', () => {
    expect(revisions(planUp(mergedGraph(), new Set()))).toEqual([
      '0001_init',
      '0002_alpha',
      '0002_beta',
      '0003_merge',
    ]);
  });

  it('skips already applied ancestors and keeps missing siblings', () => {
    expect(
      revisions(
        planUp(
          mergedGraph(),
          new Set(['0001_init', '0002_alpha']),
          '0003_merge'
        )
      )
    ).toEqual(['0002_beta', '0003_merge']);
  });

  it('applies all heads explicitly in an unmerged graph', () => {
    expect(revisions(planUp(unmergedGraph(), new Set(), 'heads'))).toEqual([
      '0001_init',
      '0002_left',
      '0002_right',
    ]);
  });

  it('targets a branch by label ancestry', () => {
    expect(revisions(planUp(unmergedGraph(), new Set(), 'left@head'))).toEqual([
      '0001_init',
      '0002_left',
    ]);
  });

  it('rejects implicit head when multiple graph heads exist', () => {
    expect(() => planUp(unmergedGraph(), new Set())).toThrow(
      'Multiple graph heads found'
    );
  });

  it('rejects unknown explicit targets', () => {
    expect(() => planUp(mergedGraph(), new Set(), 'missing')).toThrow(
      'Unknown target revision: missing'
    );
  });

  it('rejects unknown branch labels', () => {
    expect(() => planUp(unmergedGraph(), new Set(), 'missing@head')).toThrow(
      'No graph head found for branch label missing'
    );
  });

  it('rejects ambiguous branch labels inherited by multiple heads', () => {
    expect(() => planUp(unmergedGraph(), new Set(), 'base@head')).toThrow(
      'Multiple graph heads found for branch label base'
    );
  });
});

describe('planDown', () => {
  it('returns an empty plan when nothing is applied', () => {
    expect(planDown(mergedGraph(), new Set())).toEqual([]);
  });

  it('rolls back only the current head for -1', () => {
    expect(
      revisions(
        planDown(
          mergedGraph(),
          new Set(['0001_init', '0002_alpha', '0002_beta', '0003_merge'])
        )
      )
    ).toEqual(['0003_merge']);
  });

  it('requires an explicit target when multiple current heads are applied', () => {
    expect(() =>
      planDown(
        unmergedGraph(),
        new Set(['0001_init', '0002_left', '0002_right'])
      )
    ).toThrow('Multiple current heads found');
  });

  it('downgrades to a target by removing descendants in reverse topological order', () => {
    expect(
      revisions(
        planDown(
          mergedGraph(),
          new Set(['0001_init', '0002_alpha', '0002_beta', '0003_merge']),
          '0002_alpha'
        )
      )
    ).toEqual(['0003_merge', '0002_beta']);
  });

  it('downgrades to base by removing every applied revision', () => {
    expect(
      revisions(
        planDown(
          mergedGraph(),
          new Set(['0001_init', '0002_alpha', '0002_beta', '0003_merge']),
          'base'
        )
      )
    ).toEqual(['0003_merge', '0002_beta', '0002_alpha', '0001_init']);
  });

  it('rejects unknown downgrade targets', () => {
    expect(() =>
      planDown(mergedGraph(), new Set(['0001_init']), 'missing')
    ).toThrow('Unknown target revision: missing');
  });

  it('rejects downgrading to a known but unapplied target', () => {
    expect(() =>
      planDown(mergedGraph(), new Set(['0001_init']), '0002_alpha')
    ).toThrow('Cannot downgrade to unapplied revision 0002_alpha');
  });
});

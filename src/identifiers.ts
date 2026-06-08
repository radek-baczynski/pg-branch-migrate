export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function qualifiedName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function normalizeSearchPath(
  searchPath: string | readonly string[] | undefined
): readonly string[] {
  if (searchPath === undefined) {
    return [];
  }

  return typeof searchPath === 'string' ? [searchPath] : searchPath;
}

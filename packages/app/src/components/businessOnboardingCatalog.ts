export type CatalogDomain = {
  id: string;
  label: string;
  teamName: string;
  description: string;
  seedProject: string;
  seedTasks: string[];
  mappedAgent?: string;
};

export type CatalogLoadState = {
  domains: CatalogDomain[];
  degraded: boolean;
  notice: string | null;
};

/**
 * Resolve domains from a live catalog response, falling back when the catalog
 * is missing/empty/failed. Degraded notice is non-blocking and honest.
 */
export function resolveBusinessDomainCatalog(
  loadedDomains: CatalogDomain[] | null | undefined,
  fallbackDomains: CatalogDomain[],
  loadError: string | null = null,
): CatalogLoadState {
  if (Array.isArray(loadedDomains) && loadedDomains.length > 0) {
    return { domains: loadedDomains, degraded: false, notice: null };
  }

  const reason = loadError?.trim()
    || (Array.isArray(loadedDomains) ? 'Catalog returned no domains.' : 'Catalog unavailable.');
  return {
    domains: fallbackDomains,
    degraded: true,
    notice: `Using offline domain catalog (${reason})`,
  };
}

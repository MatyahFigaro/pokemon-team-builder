export interface UsageChoiceRecord {
  name: string;
  usage: number;
}

export interface UsageSpeciesRecord {
  species: string;
  usage: number;
  rank?: number;
  abilities?: UsageChoiceRecord[];
  items?: UsageChoiceRecord[];
  moves?: UsageChoiceRecord[];
  teraTypes?: UsageChoiceRecord[];
  teammates?: UsageChoiceRecord[];
  tags?: string[];
}

export interface UsageAnalyticsSnapshot {
  source: string;
  updatedAt: string;
  formatHints: string[];
  resolvedFormat?: string;
  exactMatch: boolean;
  species: UsageSpeciesRecord[];
}

interface SmogonChaosEntry {
  'Raw count'?: number;
  Abilities?: Record<string, number>;
  Items?: Record<string, number>;
  Moves?: Record<string, number>;
  'Tera Types'?: Record<string, number>;
  Teammates?: Record<string, number>;
}

interface SmogonChaosResponse {
  info?: Record<string, unknown>;
  data?: Record<string, SmogonChaosEntry>;
}

const STATS_BASE_URL = process.env.POKEMON_STATS_BASE_URL ?? 'https://www.smogon.com/stats';
const CHAMPIONS_STATS_BASE_URL = process.env.POKEMON_CHAMPIONS_STATS_BASE_URL ?? 'https://pokemon-champions-stats.vercel.app';
const usageCache = new Map<string, UsageAnalyticsSnapshot | null>();
const pendingCache = new Map<string, Promise<UsageAnalyticsSnapshot | null>>();

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function getMonthCandidates(limit = 8): string[] {
  const months: string[] = [];
  const now = new Date();

  for (let index = 1; index <= limit; index += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  return months;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'pokemon-team-builder/0.1' },
    });

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'pokemon-team-builder/0.1' },
    });

    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function normalizeUsage(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value <= 1 ? Math.round(value * 1000) / 10 : Math.round(value * 10) / 10;
}

function toChoiceRecords(values?: Record<string, number>): UsageChoiceRecord[] {
  return Object.entries(values ?? {})
    .map(([name, usage]) => ({ name, usage: normalizeUsage(usage) }))
    .filter((entry) => entry.usage > 0)
    .sort((left, right) => right.usage - left.usage)
    .slice(0, 12);
}

function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function computeRankWeight(rank: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((((total - rank + 1) / total) * 100) * 10) / 10;
}

function isChampionsStatsPreferred(format: string): boolean {
  const id = toId(format);
  return id.includes('champions') && !id.includes('double') && !id.includes('vgc');
}

function extractChampionsRanking(html: string, formatParam: 'single' | 'double') {
  const seen = new Set<string>();
  const entries: Array<{ species: string; slug: string; rank: number; japaneseName: string }> = [];
  const pattern = new RegExp(`href="/pokemon/([^"?]+)\\?season=([^"&]+)&amp;format=${formatParam}"[\\s\\S]{0,500}?<span[^>]*>(\\d+)</span>[\\s\\S]{0,200}?alt="([^"]+)"`, 'g');

  for (const match of html.matchAll(pattern)) {
    const slug = match[1] ?? '';
    const rank = Number(match[3] ?? '0');
    const japaneseName = match[4] ?? '';
    if (!slug || !rank || seen.has(slug)) continue;
    seen.add(slug);
    entries.push({ species: slugToDisplayName(slug), slug, rank, japaneseName });
  }

  return entries.sort((left, right) => left.rank - right.rank);
}

function parseChampionsItemChoices(html: string): UsageChoiceRecord[] {
  const section = html.match(/ITEMSもちもの[\s\S]*?(?:ABILITY|NATURE|PARTNER)/)?.[0] ?? html;
  const records = Array.from(section.matchAll(/sprites\/items\/([a-z0-9-]+)\.png[\s\S]{0,120}?([0-9]+(?:\.[0-9]+)?)%/g))
    .map((match) => ({
      name: slugToDisplayName(match[1] ?? ''),
      usage: normalizeUsage(Number(match[2] ?? '0')),
    }))
    .filter((entry) => entry.name && entry.usage > 0);

  return records.filter((entry, index, array) => array.findIndex((candidate) => candidate.name === entry.name) === index).slice(0, 8);
}

function parseChampionsPartnerChoices(html: string, nameMap: Map<string, string>): UsageChoiceRecord[] {
  const section = html.match(/PARTNER同じチーム[\s\S]*?(?:能力ポイント|MOVE LIST|##|$)/)?.[0] ?? '';
  const records = Array.from(section.matchAll(/([^\s<0-9]+)(\d+)位/g))
    .map((match) => {
      const japaneseName = (match[1] ?? '').trim();
      const rank = Number(match[2] ?? '0');
      return {
        name: nameMap.get(japaneseName) ?? japaneseName,
        usage: normalizeUsage(Math.max(1, 100 - ((rank - 1) * 12))),
      } satisfies UsageChoiceRecord;
    })
    .filter((entry) => Boolean(entry.name));

  return records.filter((entry, index, array) => array.findIndex((candidate) => candidate.name === entry.name) === index).slice(0, 6);
}

async function fetchChampionsSnapshot(format: string): Promise<UsageAnalyticsSnapshot | null> {
  if (!isChampionsStatsPreferred(format)) return null;

  const formatParam: 'single' | 'double' = 'single';
  const season = 'M-1';
  const sourceUrl = `${CHAMPIONS_STATS_BASE_URL}/?format=${formatParam}&view=pokemon&season=${season}`;
  const html = await fetchText(sourceUrl);
  if (!html) return null;

  const ranking = extractChampionsRanking(html, formatParam);
  if (ranking.length === 0) return null;

  const jpNameMap = new Map(ranking.map((entry) => [entry.japaneseName.trim(), entry.species]));
  const species: UsageSpeciesRecord[] = ranking.map((entry) => ({
    species: entry.species,
    usage: computeRankWeight(entry.rank, ranking.length),
    rank: entry.rank,
  }));

  const detailEntries = await Promise.all(ranking.slice(0, 24).map(async (entry) => {
    const detailUrl = `${CHAMPIONS_STATS_BASE_URL}/pokemon/${entry.slug}?season=${season}&format=${formatParam}`;
    const detailHtml = await fetchText(detailUrl);
    if (!detailHtml) return null;

    return {
      species: entry.species,
      items: parseChampionsItemChoices(detailHtml),
      teammates: parseChampionsPartnerChoices(detailHtml, jpNameMap),
    } satisfies Partial<UsageSpeciesRecord> & { species: string };
  }));

  for (const detail of detailEntries) {
    if (!detail) continue;
    const target = species.find((entry) => toId(entry.species) === toId(detail.species));
    if (!target) continue;
    target.items = detail.items;
    target.teammates = detail.teammates;
  }

  const updatedAt = html.match(/最終更新[:：]\s*([0-9/ :]+)/)?.[1]?.trim().replace(/\//g, '-') ?? season;
  return {
    source: sourceUrl,
    updatedAt,
    formatHints: [normalize(format), `champions-${formatParam}`],
    resolvedFormat: `pokemon-champions-${formatParam}-${season}`,
    exactMatch: true,
    species,
  } satisfies UsageAnalyticsSnapshot;
}

function mergeUsageSnapshots(primary: UsageAnalyticsSnapshot, fallback: UsageAnalyticsSnapshot | null): UsageAnalyticsSnapshot {
  if (!fallback) return primary;

  const mergedSpecies = primary.species.map((entry) => {
    const fallbackEntry = fallback.species.find((candidate) => toId(candidate.species) === toId(entry.species));
    if (!fallbackEntry) return entry;

    return {
      ...fallbackEntry,
      ...entry,
      abilities: entry.abilities?.length ? entry.abilities : fallbackEntry.abilities,
      items: entry.items?.length ? entry.items : fallbackEntry.items,
      moves: entry.moves?.length ? entry.moves : fallbackEntry.moves,
      teraTypes: entry.teraTypes?.length ? entry.teraTypes : fallbackEntry.teraTypes,
      teammates: entry.teammates?.length ? entry.teammates : fallbackEntry.teammates,
    } satisfies UsageSpeciesRecord;
  });

  return {
    ...primary,
    formatHints: Array.from(new Set([...primary.formatHints, ...fallback.formatHints])),
    species: mergedSpecies,
  } satisfies UsageAnalyticsSnapshot;
}

function inferFormatPatterns(format: string): RegExp[] {
  const id = toId(format);

  if (id.includes('championsbss') || id.includes('bss') || id.includes('battlestadium')) {
    return [/^gen9bssreg[a-z]+-0\.json$/i, /^gen9bss-0\.json$/i];
  }

  if (id.includes('championsou') || id.endsWith('ou') || id.includes('gen9ou')) {
    return [/^gen9ou-0\.json$/i];
  }

  if (id.includes('vgc') || id.includes('doubles')) {
    return [/^gen9vgc.*-0\.json$/i];
  }

  return [new RegExp(`^${id}-0\\.json$`, 'i')];
}

function pickBestStatsFile(format: string, files: string[]): { file: string; exactMatch: boolean } | null {
  const formatId = toId(format);
  const direct = files.find((file) => toId(file.replace(/-0\.json$/i, '')) === formatId);
  if (direct) return { file: direct, exactMatch: true };

  for (const pattern of inferFormatPatterns(format)) {
    const matches = files.filter((file) => pattern.test(file)).sort((left, right) => right.localeCompare(left));
    if (matches.length > 0 && matches[0]) {
      return { file: matches[0], exactMatch: false };
    }
  }

  return null;
}

async function resolveStatsUrl(format: string): Promise<{ url: string; resolvedFormat: string; exactMatch: boolean } | null> {
  for (const month of getMonthCandidates()) {
    const listingUrl = `${STATS_BASE_URL}/${month}/chaos/`;
    const html = await fetchText(listingUrl);
    if (!html) continue;

    const files = Array.from(html.matchAll(/href="([^"]+\.json)"/g))
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value));
    const targetFile = pickBestStatsFile(format, files);
    if (targetFile) {
      return {
        url: `${listingUrl}${targetFile.file}`,
        resolvedFormat: targetFile.file.replace(/-0\.json$/i, ''),
        exactMatch: targetFile.exactMatch,
      };
    }
  }

  return null;
}

function buildSnapshotFromChaos(
  format: string,
  sourceUrl: string,
  payload: SmogonChaosResponse,
  resolvedFormat?: string,
  exactMatch = false,
): UsageAnalyticsSnapshot | null {
  const entries = Object.entries(payload.data ?? {});
  if (entries.length === 0) return null;

  const totalRawCount = entries.reduce((sum, [, entry]) => sum + (entry['Raw count'] ?? 0), 0);
  const species = entries
    .map(([name, entry]) => ({
      species: name,
      usage: totalRawCount > 0 ? Math.round((((entry['Raw count'] ?? 0) / totalRawCount) * 100) * 10) / 10 : 0,
      rank: undefined,
      abilities: toChoiceRecords(entry.Abilities),
      items: toChoiceRecords(entry.Items),
      moves: toChoiceRecords(entry.Moves),
      teraTypes: toChoiceRecords(entry['Tera Types']),
      teammates: toChoiceRecords(entry.Teammates),
    }))
    .filter((entry) => entry.usage > 0)
    .sort((left, right) => right.usage - left.usage);

  if (species.length === 0) return null;

  const updatedAt = sourceUrl.match(/stats\/([0-9]{4}-[0-9]{2})\//)?.[1] ?? 'unknown';
  return {
    source: sourceUrl,
    updatedAt,
    formatHints: [normalize(format), normalize(resolvedFormat)],
    resolvedFormat,
    exactMatch,
    species,
  } satisfies UsageAnalyticsSnapshot;
}

export async function preloadUsageAnalytics(format: string): Promise<UsageAnalyticsSnapshot | null> {
  const key = normalize(format);
  if (usageCache.has(key)) return usageCache.get(key) ?? null;
  if (pendingCache.has(key)) return pendingCache.get(key) ?? null;

  const pending = (async () => {
    const resolved = await resolveStatsUrl(format);
    const payload = resolved ? await fetchJson<SmogonChaosResponse>(resolved.url) : null;
    const smogonSnapshot = resolved && payload
      ? buildSnapshotFromChaos(format, resolved.url, payload, resolved.resolvedFormat, resolved.exactMatch)
      : null;

    if (smogonSnapshot?.exactMatch) {
      usageCache.set(key, smogonSnapshot);
      pendingCache.delete(key);
      return smogonSnapshot;
    }

    const championsSnapshot = await fetchChampionsSnapshot(format);
    const snapshot = championsSnapshot
      ? mergeUsageSnapshots(championsSnapshot, smogonSnapshot)
      : smogonSnapshot;

    usageCache.set(key, snapshot);
    pendingCache.delete(key);
    return snapshot;
  })();

  pendingCache.set(key, pending);
  return pending;
}

export function getUsageAnalyticsForFormat(format: string): UsageAnalyticsSnapshot | null {
  return usageCache.get(normalize(format)) ?? null;
}

export function getSpeciesUsage(format: string, speciesName: string): UsageSpeciesRecord | null {
  const snapshot = getUsageAnalyticsForFormat(format);
  if (!snapshot) return null;

  const speciesId = toId(speciesName);
  return snapshot.species.find((record) => toId(record.species) === speciesId) ?? null;
}

export function getUsageWeight(format: string, speciesName: string): number {
  const snapshot = getUsageAnalyticsForFormat(format);
  const record = getSpeciesUsage(format, speciesName);
  if (!snapshot || !record) return 0;

  const peakUsage = snapshot.species[0]?.usage ?? 1;
  return Math.max(0, Math.min(1, record.usage / peakUsage));
}

export function getTopUsageThreatNames(format: string, limit = 15): string[] {
  const snapshot = getUsageAnalyticsForFormat(format);
  if (!snapshot) return [];

  return snapshot.species
    .slice()
    .sort((left, right) => right.usage - left.usage)
    .slice(0, Math.max(1, limit))
    .map((record) => record.species);
}

export function getTopUsageNames(records?: UsageChoiceRecord[], limit = 6): string[] {
  return (records ?? [])
    .slice()
    .sort((left, right) => right.usage - left.usage)
    .slice(0, Math.max(1, limit))
    .map((record) => record.name);
}

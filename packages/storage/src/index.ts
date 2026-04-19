export * from './bss-meta.js';

export interface StoredTeamRecord {
  id: string;
  format: string;
  createdAt: string;
  teamText: string;
}

export interface TeamRepository {
  save(record: StoredTeamRecord): Promise<void>;
  get(id: string): Promise<StoredTeamRecord | null>;
}

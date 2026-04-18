import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { TeamRepository, StoredTeamRecord } from './index.js';

export class JsonTeamRepository implements TeamRepository {
  constructor(private readonly baseDir: string) {}

  async save(record: StoredTeamRecord): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(join(this.baseDir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  async get(id: string): Promise<StoredTeamRecord | null> {
    try {
      const content = await fs.readFile(join(this.baseDir, `${id}.json`), 'utf8');
      return JSON.parse(content) as StoredTeamRecord;
    } catch {
      return null;
    }
  }
}

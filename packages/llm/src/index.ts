import type { ParsedIntent } from '@pokemon/domain';

export async function parseIntent(rawText: string): Promise<ParsedIntent> {
  return {
    action: 'explain',
    rawText,
  };
}

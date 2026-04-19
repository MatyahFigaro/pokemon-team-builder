import type { ParsedIntent } from '@pokemon/domain';

export interface CoachingContext {
  action: 'build' | 'analyze' | 'simulate' | 'explain';
  format?: string;
  style?: string;
  anchors?: string[];
  missingRoles?: string[];
  issues?: string[];
  notes?: string[];
  recommendations?: Array<{
    species?: string;
    title?: string;
    rationale?: string;
    reasons?: string[];
  }>;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function parseIntent(rawText: string): Promise<ParsedIntent> {
  return {
    action: rawText.toLowerCase().includes('simulate') ? 'simulate' : 'explain',
    rawText,
  };
}

export function buildCoachingNotes(context: CoachingContext): string[] {
  const notes: string[] = [];
  const leadRecommendation = context.recommendations?.[0];

  if (context.action === 'build') {
    if (leadRecommendation?.species) {
      notes.push(`${leadRecommendation.species} is the cleanest next add because it patches the shell without warping your bring-3 plan.`);
    }

    if ((context.missingRoles?.length ?? 0) > 0) {
      notes.push(`Keep the next slots focused on ${context.missingRoles?.slice(0, 2).join(' and ')} instead of duplicating overlap.`);
    }
  }

  if (context.action === 'analyze' && (context.issues?.length ?? 0) > 0) {
    notes.push(`The biggest structural pressure point right now is ${context.issues?.[0]?.toLowerCase() ?? 'the current matchup spread'}.`);
  }

  if (context.action === 'simulate') {
    notes.push('Use the sim notes to choose a low-risk lead and preserve your speed control for the midgame.');
  }

  if ((context.notes ?? []).some((note) => note.toLowerCase().includes('mega'))) {
    notes.push('Treat Mega slots as matchup tools, not automatic brings every game.');
  }

  if ((context.notes ?? []).some((note) => note.toLowerCase().includes('hazard'))) {
    notes.push('Avoid spending multiple team slots on passive hazard overlap unless the shell is built to exploit it.');
  }

  if ((context.notes ?? []).some((note) => note.toLowerCase().includes('simulation'))) {
    notes.push('Lean on the sim-backed options first when two candidates look close on paper.');
  }

  return uniqueStrings(notes).slice(0, 3);
}

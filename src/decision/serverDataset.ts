import sample from '../../data/sample-jiangsu-2026-phys.json';
import rulesData from '../../data/rules.example.json';
import type { CandidateCard, Rule } from './types';

/** Server-only default dataset loader. Do not import this from client components. */
export function getDefaultCandidates(): CandidateCard[] {
  return (sample.cards ?? []) as unknown as CandidateCard[];
}

export function getDefaultRules(): Rule[] {
  return (rulesData.rules ?? []) as unknown as Rule[];
}

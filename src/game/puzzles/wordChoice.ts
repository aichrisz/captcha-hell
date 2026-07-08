import type { FinalChoice } from '../types'

export interface WordChoiceData {
  prompt: string
  options: string[]
  correctIndex?: number          // round 7
  branch?: FinalChoice[]         // round 10: index -> final choice
}

export interface ChoiceResult {
  passed: boolean
  finalChoice?: FinalChoice
}

// rule: correct index (round 7) or branch map (round 10, every pick passes).
export function evalChoice(index: number, rule: number | FinalChoice[]): ChoiceResult {
  if (typeof rule === 'number') {
    return { passed: index === rule }
  }
  return { passed: true, finalChoice: rule[index] }
}

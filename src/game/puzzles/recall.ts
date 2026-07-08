export interface RecallData {
  prompt: string
  sourceRound: number
  fallbackCount: number
}

// Small deterministic PRNG so option order is testable.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Four distinct options: the actual count plus three nearby distractors.
export function buildRecallOptions(actualCount: number, seed = 1): number[] {
  const rand = mulberry32(seed)
  const options = new Set<number>([actualCount])
  const offsets = [1, -1, 2, -2, 3, -3, 4]
  for (const off of offsets) {
    if (options.size >= 4) break
    const candidate = actualCount + off
    if (candidate >= 0) options.add(candidate)
  }
  let bump = 5
  while (options.size < 4) {
    options.add(actualCount + bump)
    bump += 1
  }

  const list = [...options]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

export function evalRecall(pick: number, actual: number): boolean {
  return pick === actual
}

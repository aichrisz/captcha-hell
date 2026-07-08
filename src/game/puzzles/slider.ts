export interface SliderData {
  prompt: string
  target: number       // 0-100
  tolerance: number    // starting half-width of the pass zone
  shrinkRate: number   // multiplier applied per miss, e.g. 0.5
  floor: number        // tolerance never below this
  maxMisses: number    // 3rd miss = strike
}

export function evalSlider(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance
}

export function shrinkTolerance(tolerance: number, shrinkRate: number, floor: number): number {
  return Math.max(floor, tolerance * shrinkRate)
}

export interface SliderAttempt {
  passed: boolean
  tolerance: number
  misses: number
  strike: boolean
}

export function attemptSlider(
  value: number,
  data: Pick<SliderData, 'target' | 'shrinkRate' | 'floor' | 'maxMisses'>,
  tolerance: number,
  missesSoFar: number,
): SliderAttempt {
  if (evalSlider(value, data.target, tolerance)) {
    return { passed: true, tolerance, misses: missesSoFar, strike: false }
  }
  const misses = missesSoFar + 1
  return {
    passed: false,
    tolerance: shrinkTolerance(tolerance, data.shrinkRate, data.floor),
    misses,
    strike: misses >= data.maxMisses,
  }
}

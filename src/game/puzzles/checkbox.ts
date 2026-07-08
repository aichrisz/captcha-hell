export interface CheckboxData {
  prompt: string
  maxDodges: number      // pointer attempts that dodge before allowing
  freezeMode?: boolean   // round 10: after dodges, freeze instead of allow
}

export interface CheckboxState {
  dodgeCount: number
  offsetX: number
  offsetY: number
  frozen: boolean
  checked: boolean
}

export type CheckboxEvent = 'dodge' | 'checked' | 'freeze' | 'noop'

export interface CheckboxStep {
  state: CheckboxState
  event: CheckboxEvent
}

const DODGE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [110, 34],
  [-96, 58],
  [72, -30],
  [-60, -44],
]

export function initCheckbox(): CheckboxState {
  return { dodgeCount: 0, offsetX: 0, offsetY: 0, frozen: false, checked: false }
}

// One pointer attempt on the checkbox. reducedMotion keeps position still
// (UI shows "try again" copy) and needs only one failed attempt.
export function nextCheckboxState(
  state: CheckboxState,
  data: Pick<CheckboxData, 'maxDodges' | 'freezeMode'>,
  reducedMotion = false,
): CheckboxStep {
  if (state.checked || state.frozen) {
    return { state, event: 'noop' }
  }

  const dodgeLimit = reducedMotion ? Math.min(1, data.maxDodges) : data.maxDodges

  if (state.dodgeCount < dodgeLimit) {
    const [dx, dy] = DODGE_OFFSETS[state.dodgeCount % DODGE_OFFSETS.length]
    return {
      state: {
        ...state,
        dodgeCount: state.dodgeCount + 1,
        offsetX: reducedMotion ? 0 : dx,
        offsetY: reducedMotion ? 0 : dy,
      },
      event: 'dodge',
    }
  }

  if (data.freezeMode) {
    return { state: { ...state, frozen: true, offsetX: 0, offsetY: 0 }, event: 'freeze' }
  }

  return { state: { ...state, checked: true, offsetX: 0, offsetY: 0 }, event: 'checked' }
}

export interface ShareInput {
  title: string
  score: number
  strikes: number
  suspicion: number
  humanity: number
  win: boolean
}

// Plain text card for the clipboard. Hyphens only, no unicode dashes.
export function buildShareText(input: ShareInput): string {
  const verdict = input.win ? 'PASSED' : 'DENIED'
  return [
    `CAPTCHA HELL - ${input.title}`,
    `verdict: ${verdict} | score ${input.score}`,
    `strikes ${input.strikes}/3 | suspicion ${input.suspicion} | humanity ${input.humanity}%`,
    'I argued with a checkbox about being alive. Your turn.',
  ].join('\n')
}

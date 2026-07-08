import { describe, expect, it } from 'vitest'
import { buildShareText } from './share'

const base = { title: 'VERIFIED: HUMAN', score: 1234, strikes: 1, suspicion: 35, humanity: 62, win: true }

describe('buildShareText', () => {
  it('includes every stat and the title', () => {
    const text = buildShareText(base)
    expect(text).toContain('VERIFIED: HUMAN')
    expect(text).toContain('score 1234')
    expect(text).toContain('strikes 1/3')
    expect(text).toContain('suspicion 35')
    expect(text).toContain('humanity 62%')
  })

  it('reports the verdict by win flag', () => {
    expect(buildShareText(base)).toContain('PASSED')
    expect(buildShareText({ ...base, win: false })).toContain('DENIED')
  })

  it('is four lines with no unicode dashes', () => {
    const text = buildShareText(base)
    expect(text.split('\n')).toHaveLength(4)
    expect(text).not.toContain('\u2012')
    expect(text).not.toContain('\u2013')
    expect(text).not.toContain('\u2014')
    expect(text).not.toContain('\u2015')
  })
})

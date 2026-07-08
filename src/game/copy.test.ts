import { describe, expect, it } from 'vitest'

// Dash gate: no unicode dash-like characters anywhere in shipped source or docs.
// Hyphen only, per the copy constraints.
const BAD_DASHES = ['\u2012', '\u2013', '\u2014', '\u2015']

const sources = {
  ...import.meta.glob('../**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/index.html', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/README.md', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

describe('dash gate', () => {
  it('scans a meaningful set of files', () => {
    const paths = Object.keys(sources)
    expect(paths.length).toBeGreaterThan(20)
    expect(paths.some((p) => p.endsWith('index.html'))).toBe(true)
    expect(paths.some((p) => p.endsWith('README.md'))).toBe(true)
    expect(paths.some((p) => p.endsWith('.css'))).toBe(true)
    expect(paths.some((p) => p.endsWith('.tsx'))).toBe(true)
  })

  for (const [path, content] of Object.entries(sources)) {
    it(`no unicode dashes in ${path}`, () => {
      const hit = BAD_DASHES.find((dash) => content.includes(dash))
      expect(hit, `found ${JSON.stringify(hit)} in ${path}`).toBeUndefined()
    })
  }
})

import { describe, expect, it } from 'vitest'
import {
  ENDING_COLLECTION_KEY,
  parseBestRecord,
  parseEndingIds,
  readEndingIds,
  writeEndingIds,
} from './storage'

describe('ending collection storage', () => {
  it('treats malformed JSON and valid JSON with the wrong shape as empty', () => {
    expect(parseEndingIds('{')).toEqual([])
    expect(parseEndingIds('{"ids":["verified"]}')).toEqual([])
    expect(parseEndingIds('null')).toEqual([])
  })

  it('keeps only unique own EndingId values and returns registry order', () => {
    expect(parseEndingIds(JSON.stringify(['ghost', 'unknown', 'verified', 'ghost', 'constructor', 'flagged'])))
      .toEqual(['verified', 'ghost', 'flagged'])
  })

  it('limits parsed discoveries to the six valid registry entries', () => {
    expect(parseEndingIds(JSON.stringify(['tooPerfect', 'verified', 'probablyHuman', 'ghost', 'rejected', 'flagged', 'verified'])))
      .toHaveLength(6)
  })

  it('catches unavailable storage reads independently from malformed data', () => {
    expect(readEndingIds({ getItem() { throw new Error('blocked read') } })).toEqual([])
  })

  it('writes the normalized complete collection and returns false without throwing on blocked writes', () => {
    const writes: Array<[string, string]> = []
    expect(writeEndingIds(['ghost', 'verified', 'ghost'], {
      setItem(key: string, value: string) { writes.push([key, value]) },
    })).toBe(true)
    expect(writes).toEqual([[ENDING_COLLECTION_KEY, '["verified","ghost"]']])
    expect(writeEndingIds(['ghost'], { setItem() { throw new Error('blocked write') } })).toBe(false)
  })
})

describe('best record validation', () => {
  it('accepts only finite nonnegative scores, registered endings, and string timestamps', () => {
    expect(parseBestRecord(JSON.stringify({ score: 12, ending: 'verified', at: '2026-10-21T00:00:00.000Z' })))
      .toEqual({ score: 12, ending: 'verified', at: '2026-10-21T00:00:00.000Z' })
    for (const value of [
      '{',
      JSON.stringify({ score: -1, ending: 'verified', at: 'now' }),
      JSON.stringify({ score: Infinity, ending: 'verified', at: 'now' }),
      JSON.stringify({ score: 1, ending: 'constructor', at: 'now' }),
      JSON.stringify({ score: 1, ending: 'verified', at: 3 }),
      JSON.stringify({ score: '1', ending: 'verified', at: 'now' }),
    ]) expect(parseBestRecord(value)).toBeNull()
    expect(parseBestRecord(null)).toBeNull()
  })
})

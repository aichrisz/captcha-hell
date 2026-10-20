import { ENDING_COPY } from './endings'
import type { EndingId } from './types'

export const ENDING_COLLECTION_KEY = 'captcha-hell.endings.v1'
const ENDING_IDS = Object.keys(ENDING_COPY) as EndingId[]

type BestRecord = { score: number; ending: EndingId; at: string }
type EndingIds = readonly EndingId[]
type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

function isEndingId(value: unknown): value is EndingId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENDING_COPY, value)
}

export function parseEndingIds(raw: string | null): EndingId[] {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const found = new Set(value.filter(isEndingId))
    return ENDING_IDS.filter((ending) => found.has(ending))
  } catch {
    return []
  }
}

export function readEndingIds(storage?: StorageReader): EndingId[] {
  try {
    return parseEndingIds((storage ?? window.localStorage).getItem(ENDING_COLLECTION_KEY))
  } catch {
    return []
  }
}

export function writeEndingIds(ids: EndingIds, storage?: StorageWriter): boolean {
  try {
    const found = new Set(ids.filter(isEndingId))
    const normalized = ENDING_IDS.filter((ending) => found.has(ending))
    ;(storage ?? window.localStorage).setItem(ENDING_COLLECTION_KEY, JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

export function parseBestRecord(raw: string | null): BestRecord | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (typeof record.score !== 'number' || !Number.isFinite(record.score) || record.score < 0) return null
    if (!isEndingId(record.ending) || typeof record.at !== 'string') return null
    return { score: record.score, ending: record.ending, at: record.at }
  } catch {
    return null
  }
}

export function readBestRecord(storage?: StorageReader): BestRecord | null {
  try {
    return parseBestRecord((storage ?? window.localStorage).getItem('captcha-hell.best.v1'))
  } catch {
    return null
  }
}

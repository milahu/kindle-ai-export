import fs from 'node:fs/promises'

import hashObjectImpl from 'hash-object'
import timeFormat from 'hh-mm-ss'

export {
  assert,
  getEnv,
  normalizeAuthors,
  parseJsonpResponse
} from 'kindle-api-ky'

const numerals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

export function deromanize(romanNumeral) {
  const roman = romanNumeral.toUpperCase().split('')
  let num = 0
  let val = 0

  while (roman.length) {
    val = numerals[roman.shift() ]
    num += val * (val < numerals[roman[0] ] ? -1 : 1)
  }

  return num
}

export async function fileExists(
  filePath,
  mode = fs.constants.F_OK | fs.constants.R_OK
) {
  try {
    await fs.access(filePath, mode)
    return true
  } catch {
    return false
  }
}

export function hashObject(obj) {
  return hashObjectImpl(obj, {
    algorithm: 'sha1',
    encoding: 'hex'
  })
}

 








export function ffmpegOnProgress(
  onProgress,
  durationMs
) {
  return (event) => {
    let progress = 0

    try {
      const timestamp = timeFormat.toMs(event.timemark)
      progress = timestamp / durationMs
    } catch {}

    if (
      Number.isNaN(progress) &&
      event.percent !== undefined &&
      !Number.isNaN(event.percent)
    ) {
      progress = event.percent / 100
    }

    if (!Number.isNaN(progress)) {
      progress = Math.max(0, Math.min(1, progress))
      onProgress(progress, event)
    }
  }
}

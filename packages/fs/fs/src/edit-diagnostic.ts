/**
 * Bounded indentation and fuzzy-similarity diagnostics for `FS_EDIT_NOT_FOUND`
 * failures so models can self-correct whitespace or minor token mismatches in
 * a single step without re-reading the entire file.
 *
 * @module @deepseek-ai/dsh-fs/edit-diagnostic
 */

const MAX_OLD_STRING_CHARS = 20_000
const MAX_FILE_CHARS = 500_000
const MAX_PREVIEW_LINES = 24
const MIN_FUZZY_SCORE = 0.45

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function leadingWhitespace(line: string): string {
  const match = line.match(/^[ \t]*/)
  return match ? match[0] : ''
}

function describeIndent(ws: string): string {
  if (!ws) return 'none'
  const tabs = (ws.match(/\t/g) ?? []).length
  const spaces = (ws.match(/ /g) ?? []).length
  if (tabs > 0 && spaces > 0) return `${tabs} tab(s) + ${spaces} space(s)`
  if (tabs > 0) return `${tabs} tab(s)`
  return `${spaces} space(s)`
}

function tokenize(str: string): string[] {
  return str.trim().split(/[^A-Za-z0-9_$]+/).filter(Boolean)
}

function lineSimilarity(a: string, b: string): number {
  const ta = a.trim()
  const tb = b.trim()
  if (ta === tb) return ta.length === 0 ? 0.5 : 1.0
  if (!ta || !tb) return 0
  if (ta.includes(tb) || tb.includes(ta)) {
    return 0.75 * (Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length))
  }
  const tokensA = new Set(tokenize(ta))
  const tokensB = new Set(tokenize(tb))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1
  }
  return (2 * intersection) / (tokensA.size + tokensB.size)
}

function findTrimmedMatches(fileLines: readonly string[], oldLines: readonly string[]): number[] {
  const matches: number[] = []
  const win = oldLines.length
  if (win === 0 || win > fileLines.length) return matches
  const trimmedOld = oldLines.map((line) => line.trim())

  for (let i = 0; i <= fileLines.length - win; i++) {
    let ok = true
    for (let j = 0; j < win; j++) {
      if (fileLines[i + j]!.trim() !== trimmedOld[j]) {
        ok = false
        break
      }
    }
    if (ok) matches.push(i)
  }
  return matches
}

function findBestFuzzyWindow(
  fileLines: readonly string[],
  oldLines: readonly string[],
): { start: number; end: number; score: number } | null {
  const win = oldLines.length
  if (win === 0 || fileLines.length === 0) return null
  const effectiveWin = Math.min(win, fileLines.length)
  if (oldLines.every((line) => line.trim().length === 0)) return null

  let bestScore = 0
  let bestStart = -1

  for (let i = 0; i <= fileLines.length - effectiveWin; i++) {
    let sum = 0
    for (let j = 0; j < effectiveWin; j++) {
      sum += lineSimilarity(fileLines[i + j]!, oldLines[j]!)
    }
    const score = sum / effectiveWin
    if (score > bestScore) {
      bestScore = score
      bestStart = i
    }
  }

  if (bestStart < 0 || bestScore < MIN_FUZZY_SCORE) return null
  return { start: bestStart, end: bestStart + effectiveWin, score: bestScore }
}

function formatSnippet(fileLines: readonly string[], startIdx: number, endIdx: number): string {
  const clampedStart = Math.max(0, startIdx)
  const clampedEnd = Math.min(fileLines.length, endIdx)
  const slice = fileLines.slice(clampedStart, Math.min(clampedEnd, clampedStart + MAX_PREVIEW_LINES))
  const formatted = slice.map((line, idx) => `${clampedStart + idx + 1}: ${line}`).join('\n')
  const truncated = clampedEnd - clampedStart > MAX_PREVIEW_LINES ? '\n... (truncated)' : ''
  return `${formatted}${truncated}`
}

/**
 * Build a concise diagnostic suffix for an unmatched literal edit string
 * against file content, or `undefined` when inputs exceed bounds or no
 * plausible candidate exists.
 * @param content - full text content of the target file.
 * @param oldString - literal search string that failed to match.
 * @returns formatted diagnostic text, or `undefined` when unavailable.
 */
export function buildEditNotFoundDiagnostic(content: string, oldString: string): string | undefined {
  if (
    oldString.length === 0
    || oldString.length > MAX_OLD_STRING_CHARS
    || content.length > MAX_FILE_CHARS
  ) {
    return undefined
  }

  const fileLines = normalizeLf(content).split('\n')
  const oldLines = normalizeLf(oldString).split('\n')

  const trimmedMatches = findTrimmedMatches(fileLines, oldLines)
  if (trimmedMatches.length > 0) {
    const firstIdx = trimmedMatches[0]!
    const actualWs = leadingWhitespace(fileLines[firstIdx]!)
    const expectedWs = leadingWhitespace(oldLines[0]!)
    const indentNote = actualWs !== expectedWs
      ? `Indentation differs on first matched line (file has ${describeIndent(actualWs)}, search had ${describeIndent(expectedWs)}).`
      : 'Trailing whitespace or internal spacing differs.'

    const locations = trimmedMatches
      .slice(0, 5)
      .map((idx) => `lines ${idx + 1}-${idx + oldLines.length}`)
      .join(', ')

    return [
      `Found ${trimmedMatches.length} whitespace-insensitive match(es) at ${locations}.`,
      indentNote,
      'Actual file content at the first match:',
      '```',
      formatSnippet(fileLines, firstIdx, firstIdx + oldLines.length),
      '```',
    ].join('\n')
  }

  const fuzzy = findBestFuzzyWindow(fileLines, oldLines)
  if (fuzzy) {
    const pct = Math.round(fuzzy.score * 100)
    return [
      `Closest similar block (${pct}% line similarity) at lines ${fuzzy.start + 1}-${fuzzy.end}:`,
      '```',
      formatSnippet(fileLines, fuzzy.start, fuzzy.end),
      '```',
    ].join('\n')
  }

  return undefined
}

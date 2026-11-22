import { describe, expect, it } from 'vitest'
import { buildEditNotFoundDiagnostic } from '@deepseek-ai/dsh-fs'

describe('buildEditNotFoundDiagnostic', () => {
  it('reports indentation mismatch and line-numbered snippet for whitespace-insensitive matches', () => {
    const content = [
      'function greet(name: string) {',
      '  const msg = `Hello, ${name}`',
      '  return msg',
      '}',
    ].join('\n')
    const oldString = [
      '    const msg = `Hello, ${name}`',
      '    return msg',
    ].join('\n')

    const diagnostic = buildEditNotFoundDiagnostic(content, oldString)
    expect(diagnostic).toBeDefined()
    expect(diagnostic).toContain('whitespace-insensitive match(es) at lines 2-3')
    expect(diagnostic).toContain('file has 2 space(s), search had 4 space(s)')
    expect(diagnostic).toContain('2:   const msg = `Hello, ${name}`')
  })

  it('reports closest fuzzy block for minor token mismatches', () => {
    const content = [
      'export function calculateTotal(items: number[]) {',
      '  const subtotal = items.reduce((a, b) => a + b, 0)',
      '  return subtotal * 1.1',
      '}',
    ].join('\n')
    const oldString = [
      '  const subtotal = items.reduce((a, b) => a + b, 0)',
      '  return subtotal * 1.2',
    ].join('\n')

    const diagnostic = buildEditNotFoundDiagnostic(content, oldString)
    expect(diagnostic).toBeDefined()
    expect(diagnostic).toContain('Closest similar block')
    expect(diagnostic).toContain('at lines 2-3')
    expect(diagnostic).toContain('3:   return subtotal * 1.1')
  })

  it('returns undefined for unrelated strings or oversized inputs', () => {
    expect(buildEditNotFoundDiagnostic('const a = 1\nconst b = 2', 'completelyDifferentSymbol()')).toBeUndefined()
    expect(buildEditNotFoundDiagnostic('abc', '')).toBeUndefined()
    expect(buildEditNotFoundDiagnostic('abc', 'x'.repeat(20_001))).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from './csvExport'

describe('csv export', () => {
  it('neutralises formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+91 99')).toBe("'+91 99")
    expect(csvCell('@me')).toBe("'@me")
  })

  it('quotes commas and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 2]])).toBe('a,b\r\n"x,y",2')
  })
})

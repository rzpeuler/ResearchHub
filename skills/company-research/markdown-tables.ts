/** Reject malformed GFM tables in atomic method sections and assembled reports. */
export function validateCompanyResearchMarkdownTables(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/)
  const errors: string[] = []
  const cells = (line: string): string[] => {
    let value = line.trim()
    if (value.startsWith('|')) value = value.slice(1)
    if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)
    const result: string[] = []
    let current = ''
    for (let index = 0; index < value.length; index++) {
      const char = value[index]!
      if (char === '|' && value[index - 1] !== '\\') { result.push(current.trim()); current = '' }
      else current += char
    }
    result.push(current.trim())
    return result
  }
  const isPipeRow = (line: string): boolean => line.includes('|') && !/^\s*```/.test(line)
  const isSeparator = (line: string): boolean => {
    if (!isPipeRow(line)) return false
    const values = cells(line)
    return values.length > 0 && values.every(value => /^:?-{3,}:?$/.test(value))
  }
  for (let index = 0; index < lines.length; index++) {
    if (!isSeparator(lines[index]!)) continue
    const separatorIndex = index
    let headerIndex = index - 1
    while (headerIndex >= 0 && !lines[headerIndex]!.trim()) headerIndex--
    if (headerIndex < 0 || !isPipeRow(lines[headerIndex]!)) {
      errors.push(`TABLE_ERROR: separator at line ${separatorIndex + 1} has no adjacent header row`)
      continue
    }
    const width = cells(lines[separatorIndex]!).length
    const header = cells(lines[headerIndex]!)
    if (header.length !== width) {
      errors.push(`TABLE_ERROR: header at line ${headerIndex + 1} has ${header.length} cells but separator has ${width}`)
      continue
    }
    if (header.some(cell => /^#{1,6}\s/.test(cell))) errors.push(`TABLE_ERROR: heading markup embedded in table header at line ${headerIndex + 1}`)
    let dataRows = 0
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeRow(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      const row = cells(lines[rowIndex]!)
      if (row.some(cell => cell.trim())) dataRows++
      if (row.length !== width) errors.push(`TABLE_ERROR: row at line ${rowIndex + 1} has ${row.length} cells; expected ${width}`)
      if (row.some(cell => /^#{1,6}\s/.test(cell))) errors.push(`TABLE_ERROR: heading markup embedded in table row at line ${rowIndex + 1}`)
    }
    // Header/separator alone renders plausibly but contains no research. In
    // particular, a later reconciliation must not erase the only data row
    // while leaving a table shell that silently passes the shape gate.
    if (!dataRows) errors.push(`TABLE_ERROR: table at line ${headerIndex + 1} has no data rows`)
    // A markdown heading immediately adjacent to a table is valid. A heading
    // that was fused to a pipe row is handled above; continue past the block.
    index = separatorIndex
  }
  return errors
}

/**
 * Losslessly repair a table row that has exactly one extra trailing cell by
 * joining that cell into the declared final column. Rows with missing or
 * multiple extra cells remain untouched and continue to fail validation.
 */
export function mergeExcessTrailingMarkdownTableCells(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const cells = (line: string): string[] => {
    let value = line.trim()
    if (value.startsWith('|')) value = value.slice(1)
    if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)
    const result: string[] = []
    let current = ''
    for (let index = 0; index < value.length; index++) {
      const char = value[index]!
      if (char === '|' && value[index - 1] !== '\\') { result.push(current.trim()); current = '' }
      else current += char
    }
    result.push(current.trim())
    return result
  }
  const separator = (line: string) => line.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell))
  let changed = false
  // A long industry section can place the next, identical period/industry
  // header after prose appended to the final annual row. Split only this exact
  // header when the preceding row matches its current table and the next
  // separator plus following data row prove the new table width.
  const industryHeader = '| 期间与分类（分行业） | 营业收入（元） | 营业成本（元） | 毛利率 | 营业收入比上年同期增减 | 营业成本比上年同期增减 | 毛利率比上年同期增减 |'
  for (let rowIndex = 1; rowIndex + 2 < lines.length; rowIndex++) {
    const line = lines[rowIndex]!
    const headerIndex = line.lastIndexOf(industryHeader)
    const narrativeIndex = line.lastIndexOf('| 上述行业预测与历史销量定义')
    if (headerIndex < 0 || line.indexOf(industryHeader) !== headerIndex || (narrativeIndex >= headerIndex)) continue
    const hasNarrative = narrativeIndex >= 0
    const rawPrefix = line.slice(0, hasNarrative ? narrativeIndex : headerIndex).trimEnd()
    const prefix = hasNarrative ? rawPrefix : rawPrefix.replace(/\|\s*\|\s*$/u, '|')
    const narrative = hasNarrative ? line.slice(narrativeIndex + 1, headerIndex).trim() : ''
    if ((hasNarrative && !narrative) || !prefix.endsWith('|')) continue
    let previousSeparator = rowIndex - 1
    while (previousSeparator >= 0 && !separator(lines[previousSeparator]!)) previousSeparator--
    if (previousSeparator < 0 || cells(prefix).length !== cells(lines[previousSeparator]!).length) continue
    const nextSeparator = rowIndex + 1
    if (!separator(lines[nextSeparator]!) || cells(lines[nextSeparator]!).length !== cells(industryHeader).length) continue
    const nextRows: string[][] = []
    for (let index = nextSeparator + 1; index < lines.length && lines[index]!.includes('|') && !separator(lines[index]!); index++) nextRows.push(cells(lines[index]!))
    if (!nextRows.some(row => row.length === cells(industryHeader).length)) continue
    lines.splice(rowIndex, 1, prefix, narrative, industryHeader)
    changed = true
    rowIndex += 2
  }
  for (let index = 1; index < lines.length; index++) {
    if (!separator(lines[index]!)) continue
    let headerIndex = index - 1
    while (headerIndex >= 0 && !lines[headerIndex]!.trim()) headerIndex--
    if (headerIndex < 0 || !lines[headerIndex]!.includes('|')) continue
    const width = cells(lines[index]!).length
    for (let rowIndex = index + 1; rowIndex < lines.length && lines[rowIndex]!.includes('|') && !separator(lines[rowIndex]!); rowIndex++) {
      const row = cells(lines[rowIndex]!)
      if (row.length !== width + 1) continue
      const merged = [...row.slice(0, width - 1), `${row[width - 1]}；${row[width]}`]
      lines[rowIndex] = `| ${merged.join(' | ')} |`
      changed = true
    }
  }
  return changed ? lines.join('\n') : markdown
}

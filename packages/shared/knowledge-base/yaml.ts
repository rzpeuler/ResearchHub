import { KnowledgeError } from './errors.ts'

interface YamlLine {
  indent: number
  text: string
  lineNumber: number
}

function stripComment(value: string): string {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if ((character === '"' || character === "'") && value[index - 1] !== '\\') {
      quote = quote === character ? undefined : quote ?? character
    }
    if (character === '#' && !quote && (index === 0 || /\s/.test(value[index - 1] ?? ''))) {
      return value.slice(0, index).trimEnd()
    }
  }
  return value.trimEnd()
}

function tokenize(text: string): YamlLine[] {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    const withoutComment = stripComment(raw)
    if (!withoutComment.trim()) return []
    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0
    if (indent % 2 !== 0) {
      throw new KnowledgeError('ParseError', `YAML indentation must use two-space levels at line ${index + 1}`)
    }
    return [{ indent, text: withoutComment.trim(), lineNumber: index + 1 }]
  })
}

function splitMapping(text: string): [string, string] | undefined {
  const colon = [...text].findIndex((character, index) => character === ':' && (index === text.length - 1 || /\s/.test(text[index + 1] ?? '')))
  if (colon <= 0) return undefined
  return [text.slice(0, colon).trim(), text.slice(colon + 1).trim()]
}

function parseScalar(value: string): unknown {
  if (value === '') return {}
  if (value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\([\\"'])/g, '$1')
  }
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value)
    } catch {
      throw new KnowledgeError('ParseError', `Invalid inline JSON value: ${value}`)
    }
  }
  return value
}

class Parser {
  private index = 0

  constructor(private readonly lines: YamlLine[]) {}

  parse(): unknown {
    if (this.lines.length === 0) return {}
    const value = this.parseBlock(this.lines[0]?.indent ?? 0)
    if (this.index !== this.lines.length) {
      throw new KnowledgeError('ParseError', `Unexpected YAML content at line ${this.lines[this.index]?.lineNumber}`)
    }
    return value
  }

  private parseBlock(indent: number): unknown {
    const line = this.lines[this.index]
    if (!line || line.indent !== indent) throw new KnowledgeError('ParseError', `Unexpected YAML indentation near line ${line?.lineNumber ?? 'end'}`)
    return line.text.startsWith('- ') || line.text === '-' ? this.parseSequence(indent) : this.parseMapping(indent)
  }

  private parseMapping(indent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]
      if (!line || line.indent !== indent || line.text.startsWith('- ')) break
      const mapping = splitMapping(line.text)
      if (!mapping) throw new KnowledgeError('ParseError', `Expected key: value at line ${line.lineNumber}`)
      const [key, rawValue] = mapping
      this.index += 1
      if (rawValue) {
        result[key] = parseScalar(rawValue)
        continue
      }
      const next = this.lines[this.index]
      result[key] = next && next.indent > indent ? this.parseBlock(next.indent) : {}
    }
    return result
  }

  private parseSequence(indent: number): unknown[] {
    const result: unknown[] = []
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]
      if (!line || line.indent !== indent || (!line.text.startsWith('- ') && line.text !== '-')) break
      const itemText = line.text === '-' ? '' : line.text.slice(2).trim()
      this.index += 1
      if (!itemText) {
        const next = this.lines[this.index]
        result.push(next && next.indent > indent ? this.parseBlock(next.indent) : null)
        continue
      }
      const mapping = splitMapping(itemText)
      if (!mapping) {
        result.push(parseScalar(itemText))
        continue
      }
      const [key, rawValue] = mapping
      const item: Record<string, unknown> = {}
      item[key] = rawValue ? parseScalar(rawValue) : this.parseNestedValue(indent)
      const next = this.lines[this.index]
      if (next && next.indent > indent) Object.assign(item, this.parseMapping(next.indent))
      result.push(item)
    }
    return result
  }

  private parseNestedValue(parentIndent: number): unknown {
    const next = this.lines[this.index]
    return next && next.indent > parentIndent ? this.parseBlock(next.indent) : {}
  }
}

export function parseYaml(text: string, filePath = '<memory>'): unknown {
  const trimmed = text.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch (error) {
      throw new KnowledgeError('ParseError', `Invalid JSON/YAML asset: ${String(error)}`, filePath)
    }
  }
  try {
    return new Parser(tokenize(text)).parse()
  } catch (error) {
    if (error instanceof KnowledgeError) throw new KnowledgeError(error.code, error.message, filePath)
    throw new KnowledgeError('ParseError', String(error), filePath)
  }
}

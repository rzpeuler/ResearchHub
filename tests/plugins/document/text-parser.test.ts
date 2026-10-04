import assert from 'node:assert/strict'
import test from 'node:test'
import { PlainTextDocumentParser } from '../../../plugins/document/parsers/text/parser.ts'

const parser = new PlainTextDocumentParser()

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

test('HTML parser preserves block boundaries through later paragraphs and strips non-content', async () => {
  const filler = Array.from({ length: 18 }, (_, index) => `<p>Metadata and introductory material ${index + 1} ${'context '.repeat(18)}</p>`).join('')
  const input = `<html><head><title>Official notice</title><style>.hidden { display: none }</style></head><body>
    <div>发布单位：工业和信息化部</div>
    <p>Overview with <strong>inline emphasis</strong> and <a href="/source">a link</a>.</p>
    ${filler}
    <p>GPU服务器出货在此期间增长。</p>
    <p>存储和网络设备也纳入统计。</p>
    <script>SHOULD_NOT_APPEAR</script>
  </body></html>`

  const document = await parser.parse({ bytes: bytes(input), filename: 'notice.html', mediaType: 'text/html' })

  assert.ok(document.blocks.length > 20)
  assert.equal(document.blocks[0]?.text, 'Official notice')
  assert.equal(document.blocks[1]?.text, '发布单位：工业和信息化部')
  assert.equal(document.blocks[2]?.text, 'Overview with inline emphasis and a link .')
  assert.ok(document.blocks.some((block) => block.text.includes('GPU服务器出货')))
  assert.ok(document.blocks.some((block) => block.text.includes('存储和网络设备')))
  assert.doesNotMatch(document.normalizedText, /SHOULD_NOT_APPEAR|display: none/)

  // Downstream consumers sample block anchors, so later body text remains selectable
  // even when the metadata and introductory content would exceed a flat excerpt bound.
  const sampledLaterBlocks = document.blocks.slice(-2)
  assert.deepEqual(sampledLaterBlocks.map((block) => block.text), [
    'GPU服务器出货在此期间增长。',
    '存储和网络设备也纳入统计。',
  ])
})

test('HTML inline tags do not split a paragraph', async () => {
  const document = await parser.parse({ bytes: bytes('<p>Text before <em>emphasis</em> and after.</p>'), filename: 'inline.html', mediaType: 'text/html' })

  assert.equal(document.blocks.length, 1)
  assert.equal(document.blocks[0]?.text, 'Text before emphasis and after.')
})

test('plain text paragraph behavior is unchanged', async () => {
  const document = await parser.parse({ bytes: bytes('First line\nsecond line\n\nThird paragraph'), filename: 'note.txt', mediaType: 'text/plain' })

  assert.deepEqual(document.blocks.map((block) => block.text), ['First line\nsecond line', 'Third paragraph'])
})

test('plain text preserves repeated spaces and tabs', async () => {
  const document = await parser.parse({ bytes: bytes('Alpha   beta\t\tgamma'), filename: 'spacing.txt', mediaType: 'text/plain' })

  assert.equal(document.blocks[0]?.text, 'Alpha   beta\t\tgamma')
})

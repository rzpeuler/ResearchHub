import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
test('Docling text-first preserves page locators and refuses scanned, mixed or garbled text', () => {
  const script = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('bridge',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.importlib.metadata.version=lambda name:'test'
assert m.extract_text_first(None) is None
good=m.adapt_text_pages(['Financial product evidence '*30,'Later page business evidence '*30])
assert good['metadata']['extractionMode']=='born_digital_text'
assert good['blocks'][1]['page']==2
assert good['blocks'][1]['locator']['page']==2
assert '[第2页]' in good['normalizedText']
assert good['stats']['tableCount']==0
assert good['warnings']
assert m.adapt_text_pages(['','']) is None
assert m.adapt_text_pages(['Good text '*100,'']) is None
assert m.adapt_text_pages(['bad \\ufffd'*100]) is None
print(json.dumps({'passed':True}))`
  const result = execFileSync(process.env.RESEARCHHUB_PYTHON_EXECUTABLE ?? 'python', ['-c', script, resolve('plugins/document/parsers/docling/bridge/docling_bridge.py')], { encoding: 'utf8' })
  assert.equal(JSON.parse(result).passed, true)
})

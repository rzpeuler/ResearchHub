import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, relative, resolve } from 'node:path'

const root = resolve(process.cwd())
const port = Number(process.env.KNOWLEDGE_PROTOTYPE_PORT || 4173)
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const server = createServer(async (request, response) => {
  const requestPath = decodeURIComponent((request.url || '/tests/knowledge/index.html').split('?')[0])
  const relativePath = normalize(requestPath).replace(/^([/\\])+/, '')
  const filePath = resolve(join(root, relativePath))
  const relativeToRoot = relative(root, filePath)

  if (relativeToRoot.startsWith('..') || relativeToRoot.includes(`..${normalize('/')}`)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  try {
    const file = await stat(filePath)
    if (!file.isFile()) throw new Error('Not a file')
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' })
    createReadStream(filePath).pipe(response)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})

server.listen(port, () => {
  console.log(`Knowledge prototype: http://localhost:${port}/tests/knowledge/`)
})

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KnowledgeAccessSkill } from '../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../packages/skills/knowledge-access/loader.ts'
import { KnowledgeViewAdapter } from './frontend/knowledge-view-adapter.ts'

const defaultRoot = resolve(process.cwd())
const defaultPort = Number(process.env.KNOWLEDGE_PROTOTYPE_PORT || 4173)
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

function writeJson(response: import('node:http').ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createKnowledgeServer(root = defaultRoot): Server {
  const productionRoot = resolve(root, 'knowledge')
  const adapterPromise = new KnowledgeLoader({ rootDir: productionRoot }).load().then((index) => KnowledgeViewAdapter.create({
    access: new KnowledgeAccessSkill({ index }),
    taxonomyPath: resolve(productionRoot, 'taxonomy/sw-level-1.yaml'),
    viewPath: resolve(productionRoot, 'views/ai-hardware-industry.yaml'),
  }))

  return createServer(async (request, response) => {
    const requestPath = decodeURIComponent((request.url || '/tests/knowledge/index.html').split('?')[0])
    if (requestPath.startsWith('/api/knowledge/')) {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'Method Not Allowed' })
        return
      }
      try {
        const adapter = await adapterPromise
        if (requestPath === '/api/knowledge/directory') {
          writeJson(response, 200, adapter.getIndustryDirectoryProjection())
          return
        }
        const graphPrefix = '/api/knowledge/graph/'
        if (requestPath.startsWith(graphPrefix)) {
          writeJson(response, 200, adapter.getGraphProjection(requestPath.slice(graphPrefix.length)))
          return
        }
        const entityPrefix = '/api/knowledge/entity/'
        if (requestPath.startsWith(entityPrefix)) {
          writeJson(response, 200, adapter.getEntityDetailProjection(requestPath.slice(entityPrefix.length)))
          return
        }
        writeJson(response, 404, { error: 'Knowledge endpoint not found' })
      } catch (error) {
        const message = errorMessage(error)
        writeJson(response, message.includes('not found') || message.includes('Not found') ? 404 : 500, { error: message })
      }
      return
    }

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
}

export function startKnowledgeServer(root = defaultRoot, port = defaultPort): Server {
  const server = createKnowledgeServer(root)
  server.listen(port, () => {
    console.log(`Knowledge frontend: http://localhost:${port}/tests/knowledge/`)
  })
  return server
}

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) startKnowledgeServer()

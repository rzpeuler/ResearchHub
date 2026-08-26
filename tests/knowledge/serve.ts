import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KnowledgeAccessSkill } from '../../packages/skills/knowledge-access/index.ts'
import { KnowledgeBaseLoader } from '../../packages/shared/knowledge-base/knowledge-base-loader.ts'
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

export function createKnowledgeServer(root = defaultRoot, knowledgeBaseRoot = resolve(root, 'examples/knowledge-bases/ai-hardware')): Server {
  const adapterPromise = new KnowledgeBaseLoader().mountAndLoad(knowledgeBaseRoot).then(({ handle, index }) => KnowledgeViewAdapter.create({
    handle,
    access: new KnowledgeAccessSkill({ handle, index }),
    taxonomyRef: 'taxonomy/sw-level-1.yaml',
    viewRef: 'views/ai-hardware-industry.yaml',
  }).then((adapter) => ({ adapter, handle })))

  return createServer(async (request, response) => {
    const requestPath = decodeURIComponent((request.url || '/tests/knowledge/index.html').split('?')[0])
    if (requestPath.startsWith('/api/knowledge-bases/')) {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'Method Not Allowed' })
        return
      }
      try {
        const match = requestPath.match(/^\/api\/knowledge-bases\/([^/]+)(?:\/(directory|graph|entity)(?:\/(.*))?)?$/)
        const loaded = await adapterPromise
        if (!match || decodeURIComponent(match[1]) !== loaded.handle.knowledgeBaseId) {
          writeJson(response, 404, { error: 'Knowledge Base not found' })
          return
        }
        const kind = match[2]
        const entityId = match[3]
        const envelope = (data: unknown) => ({ knowledgeBaseId: loaded.handle.knowledgeBaseId, revision: loaded.handle.revision, data })
        if (kind === 'directory') {
          writeJson(response, 200, envelope(loaded.adapter.getIndustryDirectoryProjection()))
          return
        }
        if (kind === 'graph' && entityId) {
          writeJson(response, 200, envelope(loaded.adapter.getGraphProjection(entityId)))
          return
        }
        if (kind === 'entity' && entityId) {
          writeJson(response, 200, envelope(loaded.adapter.getEntityDetailProjection(entityId)))
          return
        }
        writeJson(response, 404, { error: 'Knowledge endpoint not found' })
      } catch (error) {
        const message = errorMessage(error)
        writeJson(response, message.includes('not found') || message.includes('Not found') ? 404 : 500, { error: message })
      }
      return
    }

    if (requestPath.startsWith('/api/knowledge/')) {
      writeJson(response, 404, { error: 'Legacy implicit Knowledge endpoint is not available' })
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

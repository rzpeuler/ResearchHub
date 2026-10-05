import { createResearchHubRuntimeServer } from './server.ts'
import { spawn } from 'node:child_process'

function openBrowserAfterStartup(origin: string): void {
  if (process.platform !== 'win32' || process.env.RESEARCHHUB_OPEN_BROWSER !== '1') return

  try {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    browser.once('error', () => process.stderr.write('Could not open the ResearchHub browser automatically.\n'))
    browser.unref()
  } catch {
    process.stderr.write('Could not open the ResearchHub browser automatically.\n')
  }
}

const mountedKnowledgeBaseRoot = process.env.RESEARCHHUB_KNOWLEDGE_BASE_ROOT?.trim() || undefined
const knowledgeBaseCatalogRoot = process.env.RESEARCHHUB_KNOWLEDGE_BASES_ROOT?.trim() || undefined
const server = await createResearchHubRuntimeServer({ cwd: process.cwd(), mountedKnowledgeBaseRoot, knowledgeBaseCatalogRoot })
const info = server.address!
process.stdout.write(`${info.origin}\n`)
openBrowserAfterStartup(info.origin)

const shutdown = () => { void server.close().catch((error) => { process.stderr.write('ResearchHub runtime shutdown failed\n'); process.exitCode = 1; if (error instanceof Error) process.stderr.write(`${error.message}\n`) }) }
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

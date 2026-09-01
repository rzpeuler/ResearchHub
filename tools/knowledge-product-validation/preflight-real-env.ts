import { loadLocalRuntimeConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'

type PreflightResult = {
  configLoaded: boolean
  provider: string
  model: string
  baseUrlHost: string
  httpStatus: number | null
  modelAvailable: boolean | null
  status: 'READY' | 'BLOCKED'
}

function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return 'invalid-url'
  }
}

async function preflight(): Promise<PreflightResult> {
  const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true })
  const result: PreflightResult = {
    configLoaded: true,
    provider: config.provider,
    model: config.model,
    baseUrlHost: baseUrlHost(config.baseUrl),
    httpStatus: null,
    modelAvailable: null,
    status: 'BLOCKED',
  }
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { accept: 'application/json', authorization: `Bearer ${config.apiKey}` },
    })
    result.httpStatus = response.status
    if (!response.ok) return result
    const body = await response.json() as { data?: unknown }
    const available = Array.isArray(body.data) && body.data.some((item) => (
      typeof item === 'object' && item !== null && 'id' in item && (item as { id?: unknown }).id === config.model
    ))
    result.modelAvailable = available
    result.status = available ? 'READY' : 'BLOCKED'
    return result
  } catch {
    return result
  }
}

try {
  console.log(JSON.stringify(await preflight()))
} catch {
  console.log(JSON.stringify({
    configLoaded: false,
    provider: 'unavailable',
    model: 'unavailable',
    baseUrlHost: 'unavailable',
    httpStatus: null,
    modelAvailable: null,
    status: 'BLOCKED',
  } satisfies PreflightResult))
  process.exitCode = 1
}

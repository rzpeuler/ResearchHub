import { loadLocalRuntimeConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'

type PreflightResult = {
  provider: string
  model: string
  baseUrlHost: string
  httpStatus: number | null
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
    provider: config.provider,
    model: config.model,
    baseUrlHost: baseUrlHost(config.baseUrl),
    httpStatus: null,
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
    provider: 'unavailable',
    model: 'unavailable',
    baseUrlHost: 'unavailable',
    httpStatus: null,
    status: 'BLOCKED',
  } satisfies PreflightResult))
  process.exitCode = 1
}

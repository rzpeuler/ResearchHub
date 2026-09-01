import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

export const ISOLATED_RUNTIME_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'RESEARCHHUB_REAL_LLM_ENABLED',
  'RESEARCHHUB_LLM_PROVIDER',
  'RESEARCHHUB_LLM_MODEL',
  'RESEARCHHUB_CURATION_MAX_TOKENS',
] as const

export function isPresent(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function isolatedEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment }
  for (const key of ISOLATED_RUNTIME_ENV_KEYS) delete childEnvironment[key]
  return childEnvironment
}

type ChildPreflight = {
  configLoaded: boolean
  provider: string
  model: string
  baseUrlHost: string
  httpStatus: number | null
  modelAvailable: boolean | null
  status: 'READY' | 'BLOCKED'
}

type DiagnosticResult = ChildPreflight & {
  parentDeepSeekApiKeyPresent: boolean
  parentOverrides: Record<string, boolean>
  isolatedEnvBootstrapSuccessful: boolean
  classification: string
}

function parseChildPreflight(stdout: string): ChildPreflight | null {
  const line = stdout.trim().split(/\r?\n/).at(-1)
  if (!line) return null
  try {
    return JSON.parse(line) as ChildPreflight
  } catch {
    return null
  }
}

function classify(result: DiagnosticResult, child: ChildPreflight | null, childExit: number | null): string {
  if (!child || !result.isolatedEnvBootstrapSuccessful)
    return childExit !== 0 && child?.configLoaded === false
      ? 'ENV FILE CREDENTIAL MISSING / USER CREDENTIAL ACTION REQUIRED'
      : 'DIAGNOSTIC INCONCLUSIVE / SOL REVIEW REQUIRED'
  if (child.httpStatus === 401)
    return 'ENV FILE CREDENTIAL INVALID / USER CREDENTIAL ACTION REQUIRED'
  if (child.httpStatus === 200 && child.modelAvailable === false)
    return 'CREDENTIAL READY / MODEL AVAILABILITY BLOCKED - SOL REVIEW REQUIRED'
  if (child.status === 'READY' && child.modelAvailable === true)
    return result.parentDeepSeekApiKeyPresent
      ? 'PARENT ENV OVERRIDE CONFIRMED / ENV FILE CREDENTIAL READY'
      : 'ENV FILE CREDENTIAL READY / NO PARENT OVERRIDE'
  return 'DIAGNOSTIC INCONCLUSIVE / SOL REVIEW REQUIRED'
}

export function runIsolatedPreflight(): DiagnosticResult {
  const parentOverrides = Object.fromEntries(
    ISOLATED_RUNTIME_ENV_KEYS.map((key) => [key, isPresent(process.env[key])]),
  )
  const childScript = join(dirname(fileURLToPath(import.meta.url)), 'preflight-real-env.ts')
  const child = spawnSync(process.execPath, [
    `--env-file=${resolve(process.cwd(), '.env')}`,
    '--import',
    'tsx',
    childScript,
  ], {
    env: isolatedEnvironment(process.env),
    encoding: 'utf8',
  })
  const childResult = parseChildPreflight(child.stdout)
  const base: DiagnosticResult = childResult ?? {
    configLoaded: false,
    provider: 'unavailable',
    model: 'unavailable',
    baseUrlHost: 'unavailable',
    httpStatus: null,
    modelAvailable: null,
    status: 'BLOCKED',
  }
  const result: DiagnosticResult = {
    ...base,
    parentDeepSeekApiKeyPresent: parentOverrides.DEEPSEEK_API_KEY ?? false,
    parentOverrides,
    isolatedEnvBootstrapSuccessful: base.configLoaded,
    classification: '',
  }
  result.classification = classify(result, childResult, child.status)
  return result
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runIsolatedPreflight()))
}

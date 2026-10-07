import type { ExchangeQAPair, ManagementCommunicationDocument } from './management-communication-contracts.ts'

export function dedupeDocuments(values: readonly ManagementCommunicationDocument[]): readonly ManagementCommunicationDocument[] {
  return dedupeByProvenance(values)
}

export function dedupeExchangeQa(values: readonly ExchangeQAPair[]): readonly ExchangeQAPair[] {
  return dedupeByProvenance(values)
}

function dedupeByProvenance<T extends { readonly id: string; readonly source: { readonly originPublisher: string; readonly hostPlatform?: string; readonly retrievalProvider?: string; readonly sourceNativeId?: string } }>(values: readonly T[]): readonly T[] {
  const selected = new Map<string, T>()
  for (const value of values) {
    const key = [value.id, value.source.originPublisher, value.source.hostPlatform ?? '', value.source.retrievalProvider ?? '', value.source.sourceNativeId ?? ''].join('|')
    if (!selected.has(key)) selected.set(key, value)
  }
  return [...selected.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)
}

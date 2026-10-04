import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Language = 'zh-CN' | 'en'
type LanguageContextValue = { readonly language: Language; readonly setLanguage: (language: Language) => void }

const storageKey = 'researchhub.language'
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

function readLanguage(): Language {
  try {
    return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function LanguageProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [language, updateLanguage] = useState<Language>(readLanguage)
  const setLanguage = useCallback((next: Language): void => {
    updateLanguage(next)
    try { window.localStorage.setItem(storageKey, next) } catch { /* Storage can be disabled; the in-memory choice still applies. */ }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue & { readonly t: (zh: string, en: string) => string } {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  const t = useCallback((zh: string, en: string): string => context.language === 'zh-CN' ? zh : en, [context.language])
  return useMemo(() => ({ ...context, t }), [context, t])
}

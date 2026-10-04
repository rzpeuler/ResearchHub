import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider, useLanguage } from '../../i18n'
import type { RuntimeClient } from '../../api/runtime-client'
import { ResearchRunPage } from './ResearchRunPage'

function LanguageToggle(): React.ReactElement {
  const { language, setLanguage } = useLanguage()
  return <button type="button" onClick={() => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN')}>Toggle language</button>
}

describe('ResearchRunPage language support', () => {
  beforeEach(() => window.localStorage.removeItem('researchhub.language'))
  afterEach(() => cleanup())

  it('switches workflow controls, fields, and validation between Chinese and English', () => {
    const client = { startResearchIndustry: vi.fn() } as unknown as RuntimeClient
    render(<LanguageProvider><LanguageToggle /><ResearchRunPage client={client} onLaunched={vi.fn()} /></LanguageProvider>)
    expect(screen.getByRole('heading', { name: '启动研究' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle language' }))
    expect(screen.getByRole('heading', { name: 'Run Research' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Industry/ }))
    expect(screen.getByLabelText('Industry name *')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start Industry' }))
    expect(screen.getByText('Industry name is required.')).toBeTruthy()
  })
})

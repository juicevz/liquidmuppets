import { describe, expect, it } from 'vitest'
import {
  creatorAddressFromPath,
  creatorPath,
  pathForView,
  performanceAgentIdFromPath,
  performancePath,
  viewFromPath,
} from './navigation'

describe('viewFromPath', () => {
  it('maps every public concept route', () => {
    expect(viewFromPath('/')).toBe('landing')
    expect(viewFromPath('/app')).toBe('marketplace')
    expect(viewFromPath('/app/')).toBe('marketplace')
    expect(viewFromPath('/app/portfolio')).toBe('portfolio')
    expect(viewFromPath('/app/create')).toBe('create')
    expect(viewFromPath('/app/muppet/42')).toBe('performance')
    expect(viewFromPath('/app/creator/0x1111111111111111111111111111111111111111')).toBe('creator')
    expect(viewFromPath('/app/pulse')).toBe('pulse')
    expect(viewFromPath('/app/watchlist')).toBe('monitor')
    expect(viewFromPath('/docs')).toBe('docs')
  })

  it('fails safely to the landing page', () => {
    expect(viewFromPath('/missing')).toBe('landing')
  })

  it('keeps generated paths synchronized', () => {
    for (const [view, path] of Object.entries(pathForView)) {
      expect(viewFromPath(path)).toBe(view)
    }
  })

  it('builds and parses shareable Muppet performance paths', () => {
    expect(performancePath(7n)).toBe('/app/muppet/7')
    expect(performanceAgentIdFromPath('/app/muppet/7')).toBe(7)
    expect(performanceAgentIdFromPath('/app/muppet/7/')).toBe(7)
    expect(performanceAgentIdFromPath('/app/muppet/nope')).toBeNull()
  })

  it('builds and parses public creator paths', () => {
    const wallet = '0x1111111111111111111111111111111111111111'
    expect(creatorPath(wallet)).toBe(`/app/creator/${wallet}`)
    expect(creatorAddressFromPath(`/app/creator/${wallet}`)).toBe(wallet)
    expect(creatorAddressFromPath(`/app/creator/${wallet}/`)).toBe(wallet)
    expect(creatorAddressFromPath('/app/creator/not-a-wallet')).toBeNull()
  })
})

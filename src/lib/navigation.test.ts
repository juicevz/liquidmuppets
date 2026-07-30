import { describe, expect, it } from 'vitest'
import { pathForView, viewFromPath } from './navigation'

describe('viewFromPath', () => {
  it('maps every public concept route', () => {
    expect(viewFromPath('/')).toBe('landing')
    expect(viewFromPath('/app')).toBe('marketplace')
    expect(viewFromPath('/app/')).toBe('marketplace')
    expect(viewFromPath('/app/portfolio')).toBe('portfolio')
    expect(viewFromPath('/app/create')).toBe('create')
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
})

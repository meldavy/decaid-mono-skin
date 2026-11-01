import { describe, expect, it } from 'vitest'
import { resolveGateway } from './gateway'

const store = (values: Record<string, string>) => ({ getItem: (k: string) => values[k] ?? null })

describe('resolveGateway', () => {
  it('uses the serving host on port 8080', () => {
    expect(resolveGateway({ search: '', hostname: '192.0.2.20', storage: store({}) }))
      .toEqual({ http: 'http://192.0.2.20:8080', ws: 'ws://192.0.2.20:8080' })
  })

  it('GLB-16 prefers the query, then Mono storage, then Streamline storage', () => {
    const storage = store({ monoGateway: 'mono.local', reaHostname: 'rea.local' })
    expect(resolveGateway({ search: '?gateway=q.local:9000', hostname: 'h', storage }).http).toBe('http://q.local:9000')
    expect(resolveGateway({ search: '', hostname: 'h', storage }).http).toBe('http://mono.local:8080')
    expect(resolveGateway({ search: '', hostname: 'h', storage: store({ reaHostname: 'rea.local' }) }).http).toBe('http://rea.local:8080')
  })

  it('strips a scheme and path from overrides', () => {
    expect(resolveGateway({ search: '?gateway=http://tablet.local/api', hostname: 'h', storage: null }).http).toBe('http://tablet.local:8080')
  })

  it('survives storage that throws', () => {
    const storage = { getItem: () => { throw new Error('blocked') } }
    expect(resolveGateway({ search: '', hostname: 'h', storage }).http).toBe('http://h:8080')
  })
})

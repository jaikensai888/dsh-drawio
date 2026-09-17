import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizePath, resolveWorkspaceInfo, type WorkspaceRegistryLike } from '../src/workspace.js'

const scratch: string[] = []

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-drawio-ws-'))
  scratch.push(dir)
  return dir
}

afterEach(async () => {
  while (scratch.length > 0) {
    const dir = scratch.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

describe('canonicalizePath', () => {
  it('canonicalizes an existing directory', async () => {
    const dir = await makeDir()
    expect(await canonicalizePath(dir)).toBe(await realpath(dir))
  })

  it('falls back to the resolved path when the directory is gone', async () => {
    // "The workspace directory disappeared" must stay reportable, not throw.
    const missing = join(await makeDir(), 'gone', '..', 'still-gone')
    expect(await canonicalizePath(missing)).toBe(resolve(missing))
  })
})

describe('resolveWorkspaceInfo', () => {
  it('scopes to the canonical cwd when the registry is absent', async () => {
    const dir = await makeDir()
    const info = await resolveWorkspaceInfo({ sessionId: 's1', cwd: dir })

    expect(info.sessionId).toBe('s1')
    expect(info.cwd).toBe(dir)
    expect(info.scopeKey).toBe(await realpath(dir))
    expect(info.registered).toBe(false)
    expect(info.workspaceId).toBeUndefined()
    expect(info.workspaceTitle).toBeUndefined()
  })

  it('prefers the registered workspace path as the scope key', async () => {
    const dir = await makeDir()
    const registry: WorkspaceRegistryLike = {
      resolveByPath: async () => ({ id: 'ws-1', path: `registered:${dir}`, title: '我的项目' }),
    }
    const info = await resolveWorkspaceInfo({ sessionId: 's1', cwd: dir, registry })

    expect(info.registered).toBe(true)
    expect(info.workspaceId).toBe('ws-1')
    expect(info.workspaceTitle).toBe('我的项目')
    expect(info.scopeKey).toBe(`registered:${dir}`)
  })

  it('degrades when the registry exists but does not know the directory', async () => {
    const dir = await makeDir()
    const registry: WorkspaceRegistryLike = { resolveByPath: async () => undefined }
    const info = await resolveWorkspaceInfo({ sessionId: 's1', cwd: dir, registry })
    expect(info.registered).toBe(false)
    expect(info.scopeKey).toBe(await realpath(dir))
  })

  it('degrades when the registry itself throws', async () => {
    const dir = await makeDir()
    const registry: WorkspaceRegistryLike = {
      resolveByPath: async () => {
        throw new Error('storage domain unavailable')
      },
    }
    const info = await resolveWorkspaceInfo({ sessionId: 's1', cwd: dir, registry })
    expect(info.registered).toBe(false)
    expect(info.scopeKey).toBe(await realpath(dir))
  })

  it('gives two spellings of one directory the same scope key', async () => {
    const dir = await makeDir()
    await mkdir(join(dir, 'sub'), { recursive: true })
    const a = await resolveWorkspaceInfo({ sessionId: 's1', cwd: join(dir, 'sub', '..') })
    const b = await resolveWorkspaceInfo({ sessionId: 's2', cwd: dir })
    expect(a.scopeKey).toBe(b.scopeKey)
  })

  it('keeps distinct directories distinct', async () => {
    const one = await makeDir()
    const two = await makeDir()
    const a = await resolveWorkspaceInfo({ sessionId: 's1', cwd: one })
    const b = await resolveWorkspaceInfo({ sessionId: 's2', cwd: two })
    expect(a.scopeKey).not.toBe(b.scopeKey)
  })
})

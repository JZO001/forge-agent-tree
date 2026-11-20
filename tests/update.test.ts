import { describe, expect, test } from 'claude-code/testing'

import {
  CHECK_EVERY_MS,
  checkForUpdate,
  findInstall,
  isDue,
  isNewer,
  manifestVersion,
  switchedOff,
  updateCommand,
  updateRecordOf,
  viaShell,
  versionParts,
} from '../hooks/update'
import type { UpdateHost, UpdateRecord } from '../hooks/update'

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const ID = 'forge-agent-tree@forge-agent-tree'

/** `claude plugin list --json` as Claude Code prints it: an install of the mod and others beside it. */
function listing(version: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify([
    { id: 'token-weather@skills-dir', version: '0.1.0', scope: 'user', enabled: true },
    { id: ID, version, scope: 'user', enabled: true, ...extra },
  ])
}

/** Claude Code beneath a check: the store, the plugin list, GitHub's plugin.json and the update command. */
function host(world: { record?: UpdateRecord; installed?: string; latest?: string; exit?: number; storeFails?: boolean; listed?: string }) {
  const runs: string[] = []
  const saved: UpdateRecord[] = []
  let installed = world.installed
  let fetched = 0
  const h: UpdateHost = {
    load: async () => world.record,
    save: async r => {
      if (world.storeFails) throw new Error('no store')
      saved.push(r)
    },
    list: async () => {
      runs.push('list')
      return world.listed ?? (installed === undefined ? '[]' : listing(installed))
    },
    manifest: async () => {
      fetched++
      return world.latest === undefined ? undefined : JSON.stringify({ name: 'forge-agent-tree', version: world.latest })
    },
    run: async argv => {
      runs.push(argv.join(' '))
      const code = world.exit ?? 0
      if (code === 0 && world.latest !== undefined) installed = world.latest
      return code
    },
  }
  return { h, runs, saved, fetched: () => fetched }
}

describe('versions', () => {
  test('numbers compare as numbers; anything that is not a plain version never counts as newer', () => {
    expect(versionParts('0.1.10')).toEqual([0, 1, 10])
    expect(versionParts('1.0.0-beta')).toBeUndefined()
    expect(isNewer('0.1.10', '0.1.9')).toBe(true)
    expect(isNewer('0.2', '0.1.9')).toBe(true)
    expect(isNewer('0.1.0', '0.1')).toBe(false)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('1.0.0-beta', '0.1.0')).toBe(false)
    expect(manifestVersion('{"version":"0.1.1"}')).toBe('0.1.1')
    expect(manifestVersion('{"version":"next"}')).toBeUndefined()
    expect(manifestVersion('<html>')).toBeUndefined()
    expect(manifestVersion(undefined)).toBeUndefined()
  })

  test('a switch is on when set to anything but empty, 0 or false', () => {
    expect(switchedOff([undefined, undefined])).toBe(false)
    expect(switchedOff(['', '0', 'false', 'FALSE'])).toBe(false)
    expect(switchedOff([undefined, '1'])).toBe(true)
    expect(switchedOff(['true'])).toBe(true)
  })

  test('the day: due with no record, a day after the last check, or with the clock set back', () => {
    expect(isDue({}, NOW)).toBe(true)
    expect(isDue({ checkedAt: NOW - CHECK_EVERY_MS + 1 }, NOW)).toBe(false)
    expect(isDue({ checkedAt: NOW - CHECK_EVERY_MS }, NOW)).toBe(true)
    expect(isDue({ checkedAt: NOW + 60_000 }, NOW)).toBe(true)
    expect(updateRecordOf({ checkedAt: 'x', failed: 3 })).toEqual({})
    expect(updateRecordOf(undefined)).toEqual({})
  })
})

describe('the install', () => {
  test('only a copy from a marketplace, enabled here and not managed, is updated', () => {
    expect(findInstall(listing('0.1.0'))).toEqual({ id: ID, version: '0.1.0', scope: 'user' })
    // a folder's copy (--plugin-dir), a skills folder's, an org's sync, the engine's own
    for (const source of ['inline', 'skills-dir', 'synced', 'builtin']) {
      expect(findInstall(JSON.stringify([{ id: `forge-agent-tree@${source}`, version: '0.1.0', enabled: true }]))).toBeUndefined()
    }
    expect(findInstall(listing('0.1.0', { enabled: false }))).toBeUndefined()
    expect(findInstall(listing('0.1.0', { scope: 'managed' }))).toBeUndefined()
    // another plugin whose name only starts the same
    expect(findInstall(JSON.stringify([{ id: 'forge-agent-tree-lite@somewhere', version: '0.7.6', enabled: true }]))).toBeUndefined()
    expect(findInstall('not json')).toBeUndefined()
    // a copy disabled here (a project install of another folder) listed before the enabled one: the enabled one (review of 2026-11-20)
    expect(findInstall(JSON.stringify([{ id: ID, version: '0.0.9', scope: 'project', enabled: false }, { id: ID, version: '0.1.0', scope: 'user', enabled: true }]))).toEqual({ id: ID, version: '0.1.0', scope: 'user' })
    expect(findInstall(JSON.stringify({ plugins: [{ id: ID, version: '0.1.0' }] }))).toEqual({ id: ID, version: '0.1.0' })
  })

  test('the command names the install and its scope, and accepts nothing on its own (no -y)', () => {
    expect(updateCommand({ id: ID, version: '0.1.0', scope: 'project' })).toEqual(['claude', 'plugin', 'update', ID, '--scope', 'project'])
    expect(updateCommand({ id: ID, version: '0.1.0' })).toEqual(['claude', 'plugin', 'update', ID])
  })

  test('through cmd.exe (an npm install on Windows) only where cmd.exe reads every argument as itself', () => {
    expect(viaShell(['claude', 'plugin', 'list', '--json'])).toEqual(['cmd.exe', '/d', '/c', 'claude', 'plugin', 'list', '--json'])
    expect(viaShell(updateCommand({ id: ID, version: '0.1.0', scope: 'user' }))).toEqual(['cmd.exe', '/d', '/c', 'claude', 'plugin', 'update', ID, '--scope', 'user'])
    // a marketplace's name never becomes a command
    for (const bad of ['forge-agent-tree@x&calc', 'forge-agent-tree@x|more', 'a b', 'x^y', '%PATH%', '"q"', 'x>y', 'x<y', 'x!y', 'x(y)']) {
      expect(viaShell(['claude', 'plugin', 'update', bad]), bad).toBeUndefined()
    }
    // only claude
    expect(viaShell(['git', 'status'])).toBeUndefined()
  })
})

describe('a check', () => {
  test('a newer version on GitHub is installed, and counts once the list shows it', async () => {
    const w = host({ installed: '0.1.0', latest: '0.1.1' })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'updated', from: '0.1.0', to: '0.1.1' })
    expect(w.runs).toEqual(['list', `claude plugin update ${ID} --scope user`, 'list'])
    // the time kept before anything ran, then again with no failure
    expect(w.saved).toEqual([{ checkedAt: NOW }, { checkedAt: NOW }])
  })

  test('nothing newer: no update runs', async () => {
    const w = host({ installed: '0.1.1', latest: '0.1.1' })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'current', version: '0.1.1' })
    expect(w.runs).toEqual(['list'])
  })

  test('checked within the day: nothing runs, nothing is read', async () => {
    const w = host({ record: { checkedAt: NOW - 60_000 }, installed: '0.1.0', latest: '0.1.1' })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'later' })
    expect(w.runs).toEqual([])
    expect(w.fetched()).toBe(0)
  })

  test('a store that cannot keep the time runs nothing (each options change starts a check again)', async () => {
    const w = host({ installed: '0.1.0', latest: '0.1.1', storeFails: true })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'later' })
    expect(w.runs).toEqual([])
    // GitHub is not asked either: the time is kept before anything else (review of 2026-11-20)
    expect(w.fetched()).toBe(0)
  })

  test('not installed from a marketplace: GitHub is not asked', async () => {
    const w = host({ listed: JSON.stringify([{ id: 'forge-agent-tree@inline', version: '0.1.0', enabled: true }]), latest: '0.1.1' })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'none' })
    expect(w.fetched()).toBe(0)
    expect(w.runs).toEqual(['list'])
  })

  test('GitHub out of reach: nothing runs', async () => {
    const w = host({ installed: '0.1.0' })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'none' })
    expect(w.runs).toEqual(['list'])
  })

  test('an update that fails is reported with its command, and that version is not tried again', async () => {
    const w = host({ installed: '0.1.0', latest: '0.1.1', exit: 1 })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'failed', to: '0.1.1', command: `claude plugin update ${ID} --scope user` })
    expect(w.saved.at(-1)).toEqual({ checkedAt: NOW, failed: '0.1.1' })
    const again = host({ record: { checkedAt: NOW, failed: '0.1.1' }, installed: '0.1.0', latest: '0.1.1' })
    expect(await checkForUpdate(again.h, NOW + CHECK_EVERY_MS)).toEqual({ kind: 'gaveUp', version: '0.1.1' })
    expect(again.runs).toEqual(['list'])
    // the day's time kept, the version that failed still remembered (review of 2026-11-20)
    expect(again.saved.at(-1)).toEqual({ checkedAt: NOW + CHECK_EVERY_MS, failed: '0.1.1' })
    // a later version is tried
    const later = host({ record: { checkedAt: NOW, failed: '0.1.1' }, installed: '0.1.0', latest: '0.1.2' })
    expect((await checkForUpdate(later.h, NOW + CHECK_EVERY_MS)).kind).toBe('updated')
  })

  test('an update that runs through but leaves the version: current, not a failure, tried again tomorrow', async () => {
    const w = host({ listed: listing('0.1.0'), latest: '0.1.1' })
    expect(await checkForUpdate(w.h, NOW)).toEqual({ kind: 'current', version: '0.1.0' })
    expect(w.saved).toEqual([{ checkedAt: NOW }])
  })
})

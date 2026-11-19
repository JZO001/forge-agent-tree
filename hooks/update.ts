/**
 * The mod's own update (plan 07, the user's decision of 2026-11-19).
 *
 * Claude Code updates a plugin from a marketplace only where that marketplace
 * has auto-update switched on, and for any but the official ones it is off,
 * with no way for the author to switch it on. So, once a day at an interactive
 * start, a copy installed from a marketplace reads the version its repository
 * holds and, when that one is newer, has Claude Code update it.
 *
 * Only decisions here, no `$`: register.tsx hands in the host (the store, the
 * `claude` command, the one request), so the tests can stand in for it.
 */

/** The store key that keeps when the last check ran, and a version that would not install. */
export const UPDATE_KEY = 'update'
/** The plugin's name, as `claude plugin list` names its installs (`<name>@<marketplace>`). */
export const PLUGIN_NAME = 'forge-agent-tree'
/** A check at most this often. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000

/** Where a copy comes from that no marketplace update reaches: a folder, a skills folder, an org's sync, the engine's own. */
const NOT_A_MARKETPLACE: ReadonlySet<string> = new Set(['inline', 'skills-dir', 'synced', 'builtin'])
/** The scopes `claude plugin update --scope` takes; a managed install is the admin's to update. */
const SCOPES: ReadonlySet<string> = new Set(['user', 'project', 'local'])

/** A copy of the mod installed from a marketplace, as `claude plugin list --json` lists it. */
export type Installed = { id: string; version: string; scope?: string }

/** What the store keeps: when the last check ran, and the version that last failed to install. */
export type UpdateRecord = { checkedAt?: number; failed?: string }

/** How a check ended; the pane says something only for `updated` and `failed`. */
export type UpdateResult =
  /** Checked less than a day ago, or the store could not keep the time: nothing ran. */
  | { kind: 'later' }
  /** Not a marketplace install, or the repository's version could not be read. */
  | { kind: 'none' }
  /** The installed version is the newest (or Claude Code found nothing newer to install). */
  | { kind: 'current'; version: string }
  /** This version failed to install before: it is not tried again. */
  | { kind: 'gaveUp'; version: string }
  | { kind: 'updated'; from: string; to: string }
  /** The update did not run through; `command` is the one to run by hand. */
  | { kind: 'failed'; to: string; command: string }

/** What a check needs from Claude Code. Each may reject; a rejection counts as nothing read. */
export type UpdateHost = {
  load: () => Promise<unknown>
  save: (record: UpdateRecord) => Promise<void>
  /** What `claude plugin list --json` prints. */
  list: () => Promise<string>
  /** The repository's plugin.json, or undefined where the answer was not a success. */
  manifest: () => Promise<string | undefined>
  /** Runs a command; its exit code. */
  run: (argv: readonly string[]) => Promise<number>
}

/** Whether any of the switches that turn updates off is set (`1`, `true`, anything but empty, `0` and `false`). */
export function switchedOff(values: ReadonlyArray<string | undefined>): boolean {
  return values.some(v => v !== undefined && v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false')
}

/** A version's numbers (`0.1.10` → `[0, 1, 10]`); anything else (a pre-release tag too) is no version. */
export function versionParts(v: string): number[] | undefined {
  const t = v.trim()
  return /^\d+(?:\.\d+){0,3}$/.test(t) ? t.split('.').map(Number) : undefined
}

/** Whether version `a` comes after `b`; false where either is no version. */
export function isNewer(a: string, b: string): boolean {
  const x = versionParts(a)
  const y = versionParts(b)
  if (!x || !y) return false
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** What was kept in the store, read leniently: a field of the wrong kind counts as absent. */
export function updateRecordOf(value: unknown): UpdateRecord {
  if (!value || typeof value !== 'object') return {}
  const v = value as { checkedAt?: unknown; failed?: unknown }
  return {
    ...(typeof v.checkedAt === 'number' && Number.isFinite(v.checkedAt) ? { checkedAt: v.checkedAt } : {}),
    ...(typeof v.failed === 'string' ? { failed: v.failed } : {}),
  }
}

/** Whether a check is due: none ran yet, or the last is a day old (or in the future, a clock set back). */
export function isDue(record: UpdateRecord, now: number): boolean {
  const at = record.checkedAt
  return at === undefined || now - at >= CHECK_EVERY_MS || at > now
}

/**
 * The mod's copy installed from a marketplace, out of what `claude plugin list
 * --json` prints: enabled where the session runs, not a folder's or a skills
 * folder's copy, not one an admin manages. With `id`, that install only.
 */
export function findInstall(listed: string, id?: string): Installed | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(listed)
  } catch {
    return undefined
  }
  const entries: unknown = Array.isArray(parsed) ? parsed : (parsed as { plugins?: unknown } | null)?.plugins
  if (!Array.isArray(entries)) return undefined
  for (const entry of entries as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { id?: unknown; version?: unknown; enabled?: unknown; scope?: unknown }
    if (typeof e.id !== 'string' || typeof e.version !== 'string') continue
    if (id !== undefined && e.id !== id) continue
    const at = e.id.indexOf('@')
    if (at <= 0 || e.id.slice(0, at) !== PLUGIN_NAME) continue
    const source = e.id.slice(at + 1)
    if (source === '' || NOT_A_MARKETPLACE.has(source)) continue
    if (e.enabled === false || e.scope === 'managed') continue
    return { id: e.id, version: e.version, ...(typeof e.scope === 'string' ? { scope: e.scope } : {}) }
  }
  return undefined
}

/** The `version` a plugin.json holds. */
export function manifestVersion(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  try {
    const v = (JSON.parse(text) as { version?: unknown } | null)?.version
    return typeof v === 'string' && versionParts(v) ? v.trim() : undefined
  } catch {
    return undefined
  }
}

/** The command that updates an install: its id, and its scope where the command takes one. */
export function updateCommand(install: Installed): string[] {
  return ['claude', 'plugin', 'update', install.id, ...(install.scope && SCOPES.has(install.scope) ? ['--scope', install.scope] : [])]
}

/**
 * One check, the cheap steps first: the day's limit from the store, then the
 * install, then the repository's version, and only for a newer one the update.
 * The time is kept before anything runs, so a start that fails waits a day too;
 * a store that cannot keep it runs nothing (each options change reloads the
 * plugin and starts this again). An update counts only when the list then
 * shows the new version; one that failed is not tried again.
 */
export async function checkForUpdate(host: UpdateHost, now: number): Promise<UpdateResult> {
  const record = updateRecordOf(await host.load().catch(() => undefined))
  if (!isDue(record, now)) return { kind: 'later' }
  const kept = await host.save({ ...record, checkedAt: now }).then(
    () => true,
    () => false,
  )
  if (!kept) return { kind: 'later' }
  const before = findInstall(await host.list().catch(() => ''))
  if (!before) return { kind: 'none' }
  const latest = manifestVersion(await host.manifest().catch(() => undefined))
  if (!latest) return { kind: 'none' }
  if (!isNewer(latest, before.version)) return { kind: 'current', version: before.version }
  if (record.failed === latest) return { kind: 'gaveUp', version: latest }
  const argv = updateCommand(before)
  const code = await host.run(argv).catch(() => undefined)
  const after = code === 0 ? findInstall(await host.list().catch(() => ''), before.id) : undefined
  if (after && isNewer(after.version, before.version)) {
    await host.save({ checkedAt: now }).catch(() => undefined)
    return { kind: 'updated', from: before.version, to: after.version }
  }
  // It ran through but the version stayed: nothing newer reached Claude Code yet. Tried again tomorrow.
  if (code === 0) return { kind: 'current', version: before.version }
  await host.save({ checkedAt: now, failed: latest }).catch(() => undefined)
  return { kind: 'failed', to: latest, command: argv.join(' ') }
}

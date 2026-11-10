import { atomicWriteFile } from '@genoffice/electron-utils/atomic-write'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TrustedCertificate } from '../shared/ipc'

/** The list is the user's own choices; a sanity cap keeps a runaway caller from growing the file without bound */
export const MAX_TRUSTED_CERTIFICATES = 500

/** SHA-256 fingerprint as Node prints it: 32 upper-case hex pairs joined by colons */
const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/

/** Normalise a fingerprint typed or passed in any case; null when it is not a SHA-256 fingerprint */
export function normalizeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const upper = value.trim().toUpperCase()
  return FINGERPRINT.test(upper) ? upper : null
}

/** Drop malformed entries (hand-edited file, older formats) instead of failing the whole list */
export function sanitizeTrusted(raw: unknown): TrustedCertificate[] {
  if (!Array.isArray(raw)) return []
  const out: TrustedCertificate[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const fingerprint = normalizeFingerprint(e.fingerprint)
    if (!fingerprint || out.some((c) => c.fingerprint === fingerprint)) continue
    out.push({
      fingerprint,
      commonName: typeof e.commonName === 'string' ? e.commonName : '',
      addedAt: typeof e.addedAt === 'number' && Number.isFinite(e.addedAt) ? e.addedAt : 0,
    })
  }
  return out.slice(0, MAX_TRUSTED_CERTIFICATES)
}

/** Add a certificate (newest first); trusting one already on the list only refreshes its name and date */
export function addTrusted(
  list: TrustedCertificate[],
  fingerprint: string,
  commonName: string,
  now: number = Date.now(),
): TrustedCertificate[] {
  const normalized = normalizeFingerprint(fingerprint)
  if (!normalized) return list
  const rest = list.filter((c) => c.fingerprint !== normalized)
  return [{ fingerprint: normalized, commonName, addedAt: now }, ...rest].slice(
    0,
    MAX_TRUSTED_CERTIFICATES,
  )
}

export function removeTrusted(
  list: TrustedCertificate[],
  fingerprint: string,
): TrustedCertificate[] {
  const normalized = normalizeFingerprint(fingerprint)
  return normalized ? list.filter((c) => c.fingerprint !== normalized) : list
}

/** The fingerprints alone, for the trust check */
export const trustedFingerprints = (list: readonly TrustedCertificate[]): ReadonlySet<string> =>
  new Set(list.map((c) => c.fingerprint))

/** Missing or unreadable file is just an empty list; a broken JSON must not break signature checks */
export async function loadTrusted(filePath: string): Promise<TrustedCertificate[]> {
  try {
    return sanitizeTrusted(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    return []
  }
}

/**
 * Atomic write so a crash mid-write can't corrupt the list. The shared writer also retries the
 * transient Windows rename locks and falls back to writing in place where a folder refuses a
 * rename over an existing file (an encrypted profile folder reports EXDEV), so a trust is never lost.
 */
export async function saveTrusted(filePath: string, list: TrustedCertificate[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await atomicWriteFile(filePath, Buffer.from(JSON.stringify(list)))
}

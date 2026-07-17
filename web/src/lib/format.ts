import { formatUnits } from 'viem'
import { EXPLORER_URL, JobStatus, type JobStatusValue, USDC_DECIMALS } from './config'

const usdcFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Formats an ERC-20 USDC amount (6 decimals) for display. */
export function formatUsdc(amount: bigint): string {
  return `${usdcFormatter.format(Number(formatUnits(amount, USDC_DECIMALS)))} USDC`
}

export function formatCompact(value: number | bigint): string {
  return compactFormatter.format(typeof value === 'bigint' ? Number(value) : value)
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

export function addressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}

export function blockUrl(block: bigint | number): string {
  return `${EXPLORER_URL}/block/${block}`
}

export function formatTimestamp(unixSeconds: number | bigint): string {
  const date = new Date(Number(unixSeconds) * 1000)
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export interface PillSpec {
  label: string
  tone: 'neutral' | 'pending' | 'positive' | 'negative' | 'muted'
}

export function statusPill(status: JobStatusValue): PillSpec {
  switch (status) {
    case JobStatus.Open:
      return { label: 'OPEN', tone: 'neutral' }
    case JobStatus.Funded:
      return { label: 'FUNDED', tone: 'pending' }
    case JobStatus.Submitted:
      return { label: 'SUBMITTED', tone: 'pending' }
    case JobStatus.Completed:
      return { label: 'SETTLED', tone: 'positive' }
    case JobStatus.Rejected:
      return { label: 'REJECTED', tone: 'negative' }
    case JobStatus.Expired:
      return { label: 'EXPIRED', tone: 'muted' }
    default:
      return { label: 'UNKNOWN', tone: 'muted' }
  }
}

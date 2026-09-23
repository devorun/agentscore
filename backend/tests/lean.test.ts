import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeFunctionResult, parseAbiParameters } from 'viem'
import { erc8183Abi } from '../src/lib/abi.js'
import { decodeJob } from '../src/lib/lean.js'

// The cron and the API decode getJob by hand (viem's codec is too costly on a cold
// isolate) — pin it against viem's encoder.
describe('cron: hand-decoded getJob', () => {
  const job = {
    id: 186651n,
    client: '0x02d2cFDB15Fe4D48820dF2431B2Bd3182636D34b',
    provider: '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918',
    evaluator: '0x5d474e5125D7ee1a63EE2f2444a88e2a518683E9',
    description: 'Übersetze die Seite — 翻訳 [TERMS tier=credit score=82] '.repeat(3),
    budget: 1_400_000n,
    expiredAt: 1_790_000_000n,
    status: 1,
    hook: '0x0000000000000000000000000000000000000000',
  } as const

  it('matches viem on every field, including a long unicode description', () => {
    const data = encodeFunctionResult({ abi: erc8183Abi, functionName: 'getJob', result: job })
    expect(decodeJob(data)).toEqual({
      id: job.id,
      client: job.client.toLowerCase(),
      provider: job.provider.toLowerCase(),
      evaluator: job.evaluator.toLowerCase(),
      description: job.description,
      budget: job.budget,
      expiredAt: job.expiredAt,
      status: job.status,
    })
  })

  it('returns undefined for a failed call or a short payload', () => {
    expect(decodeJob(undefined)).toBeUndefined()
    expect(decodeJob(encodeAbiParameters(parseAbiParameters('uint256'), [1n]))).toBeUndefined()
  })
})

describe('cron: hand-encoded Multicall3.aggregate3', () => {
  it('matches viem for mixed-length calldata', async () => {
    const { encodeFunctionData, multicall3Abi } = await import('viem')
    const { encodeAggregate3 } = await import('../src/lib/lean.js')
    const calls = [
      { target: '0x0747EEf0706327138c69792bF28Cd525089e4583', callData: `0x5b1c1f4a${'00'.repeat(31)}2a` },
      { target: '0x1489b56AaE4BB63e9793a151C12964B19bC99d38', callData: '0x12345678' },
      { target: '0x0747EEf0706327138c69792bF28Cd525089e4583', callData: `0xabcdef01${'11'.repeat(70)}` },
    ] as const
    const viemData = encodeFunctionData({ abi: multicall3Abi, functionName: 'aggregate3', args: [calls.map((c) => ({ ...c, allowFailure: true }))] })
    expect(encodeAggregate3([...calls])).toBe(viemData)
  })
})

describe('chain backfill helpers', () => {
  it('merges explorer and backfilled logs without double-counting (index 0 may arrive as "0x")', async () => {
    const { mergeLogs } = await import('../src/lib/explorer.js')
    const log = (tx: string, logIndex: `0x${string}`) => ({ address: '0x1', topics: [], data: '0x', blockNumber: '0x1', timeStamp: '0x1', transactionHash: tx, logIndex }) as never
    const merged = mergeLogs([log('0xAA', '0x'), log('0xbb', '0x2')], [log('0xaa', '0x0'), log('0xbb', '0x3')])
    expect(merged).toHaveLength(3)
  })

  it('parses AppealResolved by hand, matching viem, counting only overturned rejections by the block', async () => {
    const { encodeEventTopics, encodeAbiParameters, parseAbiParameters } = await import('viem')
    const { appealsAbi } = await import('../src/lib/abi.js')
    const { overturnedFrom } = await import('../src/lib/appeal.js')
    const agent = '0x5eA81E8823E6e50c6D1A4a087fc93d58D40545cC'
    const appeal = (jobId: bigint, original: number, result: number, block: string) => ({
      address: '0x3dd2e1410ff24007c98d8e7b12796458697733ed',
      topics: encodeEventTopics({ abi: appealsAbi, eventName: 'AppealResolved', args: { jobId, agent, appealArbiter: '0x6B357F778195C771b48F36b8108BC0066D798863' } }),
      data: encodeAbiParameters(parseAbiParameters('uint8, uint8, bool, bytes32'), [original, result, original !== result, `0x${'ab'.repeat(32)}`]),
      blockNumber: block,
      timeStamp: '0x1',
      transactionHash: `0x${jobId.toString(16)}`,
      logIndex: '0x0',
    }) as never
    const logs = [appeal(159968n, 1, 0, '0x10'), appeal(159969n, 1, 1, '0x10'), appeal(160000n, 1, 0, '0x99')]
    expect([...overturnedFrom(logs, agent, 0x50n)]).toEqual(['159968']) // upheld and later ones excluded
    expect(overturnedFrom(logs, '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918').size).toBe(0) // other agent
  })
})

import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeFunctionResult, parseAbiParameters } from 'viem'
import { erc8183Abi } from '../src/lib/abi.js'
import { decodeJob } from '../src/cron.js'

// The cron worker decodes getJob by hand (viem's codec is too costly on a cold
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
    const { encodeAggregate3 } = await import('../src/cron.js')
    const calls = [
      { target: '0x0747EEf0706327138c69792bF28Cd525089e4583', callData: `0x5b1c1f4a${'00'.repeat(31)}2a` },
      { target: '0x1489b56AaE4BB63e9793a151C12964B19bC99d38', callData: '0x12345678' },
      { target: '0x0747EEf0706327138c69792bF28Cd525089e4583', callData: `0xabcdef01${'11'.repeat(70)}` },
    ] as const
    const viemData = encodeFunctionData({ abi: multicall3Abi, functionName: 'aggregate3', args: [calls.map((c) => ({ ...c, allowFailure: true }))] })
    expect(encodeAggregate3([...calls])).toBe(viemData)
  })
})

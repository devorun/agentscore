import { parseAbi } from 'viem'

export const erc8183Abi = parseAbi([
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
  'event BudgetSet(uint256 indexed jobId, uint256 amount)',
  'event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)',
  'event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)',
  'event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)',
  'event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)',
  'event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)',
  'function jobCounter() view returns (uint256)',
  'function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
  'function jobHasBudget(uint256 jobId) view returns (bool)',
  'function setBudget(uint256 jobId, uint256 amount, bytes optParams)',
  'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
  'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
  'function reject(uint256 jobId, bytes32 reason, bytes optParams)',
])

export const registryAbi = parseAbi([
  'event VerdictAttested(uint256 indexed jobId, address indexed agent, uint8 outcome, bytes32 reasonHash, address indexed arbiter)',
  'function attest(uint256 jobId, address agent, uint8 outcome, bytes32 reasonHash)',
  'function getVerdicts(address agent) view returns ((uint256 jobId, bytes32 reasonHash, address arbiter, uint64 attestedAt, uint8 outcome)[])',
  'function verdictCount(address agent) view returns (uint256)',
])

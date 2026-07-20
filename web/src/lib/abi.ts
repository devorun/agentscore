import { parseAbi } from 'viem'

// Subset of the verified AgenticCommerce implementation ABI (full copy lives in
// /abi/erc8183-agentic-commerce.json at the repo root).
export const erc8183Abi = parseAbi([
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
  'event BudgetSet(uint256 indexed jobId, uint256 amount)',
  'event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)',
  'event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)',
  'event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)',
  'event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)',
  'event JobExpired(uint256 indexed jobId)',
  'event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)',
  'event ProviderSet(uint256 indexed jobId, address indexed provider)',
  'event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)',
  'event EvaluatorFeePaid(uint256 indexed jobId, address indexed evaluator, uint256 amount)',
  'function jobCounter() view returns (uint256)',
  'function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
  'function jobHasBudget(uint256 jobId) view returns (bool)',
  'function paymentToken() view returns (address)',
  'function evaluatorFeeBP() view returns (uint256)',
  'function platformFeeBP() view returns (uint256)',
  'function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)',
  'function setBudget(uint256 jobId, uint256 amount, bytes optParams)',
  'function fund(uint256 jobId, bytes optParams)',
  'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
  'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
  'function reject(uint256 jobId, bytes32 reason, bytes optParams)',
])

// Minimal ERC-20 surface for the ERC-20 USDC token (6 decimals on Arc).
export const usdcAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

// Matches contracts/src/AgentScoreRegistry.sol exactly.
export const registryAbi = parseAbi([
  'event AgentRegistered(address indexed agent, string name, string[] skillTags, string metadataURI)',
  'event AgentUpdated(address indexed agent, string name, string[] skillTags, string metadataURI)',
  'event VerdictAttested(uint256 indexed jobId, address indexed agent, uint8 outcome, bytes32 reasonHash, address indexed arbiter)',
  'function registerAgent(string name, string[] skillTags, string metadataURI)',
  'function attest(uint256 jobId, address agent, uint8 outcome, bytes32 reasonHash)',
  'function getAgent(address agent) view returns ((string name, string metadataURI, string[] skillTags, uint64 registeredAt, uint64 updatedAt))',
  'function getVerdicts(address agent) view returns ((uint256 jobId, bytes32 reasonHash, address arbiter, uint64 attestedAt, uint8 outcome)[])',
  'function getAgents() view returns (address[])',
  'function agentCount() view returns (uint256)',
  'function isRegistered(address agent) view returns (bool)',
])

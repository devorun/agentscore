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
  'function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)',
  'function fund(uint256 jobId, bytes optParams)',
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
  'function jobAttested(uint256 jobId) view returns (bool)',
  'function registerAgent(string name, string[] skillTags, string metadataURI)',
  'function isRegistered(address agent) view returns (bool)',
  'function getAgent(address agent) view returns ((string name, string metadataURI, string[] skillTags, uint64 registeredAt, uint64 updatedAt))',
  'function agentCount() view returns (uint256)',
])

// Official ERC-8004 registries on Arc Testnet (see lib/erc8004.ts).
export const identityAbi = parseAbi([
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'function register(string agentURI) returns (uint256 agentId)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 agentId) view returns (string)',
])

export const reputationAbi = parseAbi([
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
])

// AgentScoreAppeals — second-arbiter appeal outcomes (Outcome enum: 0=Approved, 1=Rejected).
export const appealsAbi = parseAbi([
  'event AppealResolved(uint256 indexed jobId, address indexed agent, uint8 original, uint8 result, bool overturned, bytes32 reasonHash, address indexed appealArbiter)',
  'function resolveAppeal(uint256 jobId, address agent, uint8 original, uint8 result, bytes32 reasonHash)',
  'function getAppeal(uint256 jobId) view returns ((uint256 jobId, address agent, uint8 original, uint8 result, bytes32 reasonHash, address appealArbiter, uint64 resolvedAt))',
  'function isOverturned(uint256 jobId) view returns (bool)',
  'function jobAppealed(uint256 jobId) view returns (bool)',
  'function appealCount() view returns (uint256)',
])

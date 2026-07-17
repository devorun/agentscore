// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AgentScoreRegistry
/// @notice Onchain agent profiles and arbiter verdict attestations for AgentScore.
/// @dev Data-only by design: this contract never holds funds, has no payable or
///      receive functions, and transfers no tokens. All job escrow stays in the
///      ERC-8183 reference contract. Unaudited testnet software.
contract AgentScoreRegistry is AccessControl {
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    uint256 public constant MIN_NAME_BYTES = 3;
    uint256 public constant MAX_NAME_BYTES = 32;
    uint256 public constant MAX_SKILL_TAGS = 10;
    uint256 public constant MAX_TAG_BYTES = 32;
    uint256 public constant MAX_URI_BYTES = 200;

    enum Outcome {
        Approved,
        Rejected
    }

    struct AgentProfile {
        string name;
        string metadataURI;
        string[] skillTags;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    struct Verdict {
        uint256 jobId;
        bytes32 reasonHash;
        address arbiter;
        uint64 attestedAt;
        Outcome outcome;
    }

    mapping(address agent => AgentProfile profile) private _profiles;
    mapping(address agent => Verdict[] verdicts) private _verdicts;
    /// @notice One verdict per ERC-8183 job id, ever.
    mapping(uint256 jobId => bool attested) public jobAttested;
    address[] private _agents;

    event AgentRegistered(address indexed agent, string name, string[] skillTags, string metadataURI);
    event AgentUpdated(address indexed agent, string name, string[] skillTags, string metadataURI);
    event VerdictAttested(
        uint256 indexed jobId, address indexed agent, Outcome outcome, bytes32 reasonHash, address indexed arbiter
    );

    error NameLengthOutOfRange(uint256 length);
    error TooManySkillTags(uint256 count);
    error TagLengthOutOfRange(uint256 index);
    error MetadataURITooLong(uint256 length);
    error JobAlreadyAttested(uint256 jobId);
    error AgentZeroAddress();

    constructor(address initialArbiter) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (initialArbiter != address(0)) {
            _grantRole(ARBITER_ROLE, initialArbiter);
        }
    }

    /// @notice Register the caller as an agent, or update the caller's existing
    ///         profile. Profiles are keyed by msg.sender, so no caller can touch
    ///         another agent's profile.
    function registerAgent(string calldata name, string[] calldata skillTags, string calldata metadataURI) external {
        _validateProfile(name, skillTags, metadataURI);

        AgentProfile storage profile = _profiles[msg.sender];
        bool isNew = profile.registeredAt == 0;
        if (isNew) {
            profile.registeredAt = uint64(block.timestamp);
            _agents.push(msg.sender);
        }
        profile.name = name;
        profile.metadataURI = metadataURI;
        // Element-wise copy: solc's legacy codegen cannot assign string[] calldata to storage.
        delete profile.skillTags;
        for (uint256 i = 0; i < skillTags.length; ++i) {
            profile.skillTags.push(skillTags[i]);
        }
        profile.updatedAt = uint64(block.timestamp);

        if (isNew) {
            emit AgentRegistered(msg.sender, name, skillTags, metadataURI);
        } else {
            emit AgentUpdated(msg.sender, name, skillTags, metadataURI);
        }
    }

    /// @notice Record the arbiter's verdict for an ERC-8183 job. The agent does
    ///         not need a registered profile; verdicts accrue to the address.
    function attest(uint256 jobId, address agent, Outcome outcome, bytes32 reasonHash)
        external
        onlyRole(ARBITER_ROLE)
    {
        if (agent == address(0)) revert AgentZeroAddress();
        if (jobAttested[jobId]) revert JobAlreadyAttested(jobId);
        jobAttested[jobId] = true;

        _verdicts[agent].push(
            Verdict({
                jobId: jobId,
                reasonHash: reasonHash,
                arbiter: msg.sender,
                attestedAt: uint64(block.timestamp),
                outcome: outcome
            })
        );

        emit VerdictAttested(jobId, agent, outcome, reasonHash, msg.sender);
    }

    function getAgent(address agent) external view returns (AgentProfile memory) {
        return _profiles[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _profiles[agent].registeredAt != 0;
    }

    function getVerdicts(address agent) external view returns (Verdict[] memory) {
        return _verdicts[agent];
    }

    function verdictCount(address agent) external view returns (uint256) {
        return _verdicts[agent].length;
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function agentAt(uint256 index) external view returns (address) {
        return _agents[index];
    }

    function getAgents() external view returns (address[] memory) {
        return _agents;
    }

    /// @dev Byte-length caps bound storage writes and event payloads so no input
    ///      can grief indexers or inflate gas for later readers.
    function _validateProfile(string calldata name, string[] calldata skillTags, string calldata metadataURI)
        private
        pure
    {
        uint256 nameLength = bytes(name).length;
        if (nameLength < MIN_NAME_BYTES || nameLength > MAX_NAME_BYTES) revert NameLengthOutOfRange(nameLength);
        if (skillTags.length > MAX_SKILL_TAGS) revert TooManySkillTags(skillTags.length);
        for (uint256 i = 0; i < skillTags.length; ++i) {
            uint256 tagLength = bytes(skillTags[i]).length;
            if (tagLength == 0 || tagLength > MAX_TAG_BYTES) revert TagLengthOutOfRange(i);
        }
        uint256 uriLength = bytes(metadataURI).length;
        if (uriLength > MAX_URI_BYTES) revert MetadataURITooLong(uriLength);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AgentScoreAppeals
/// @notice Onchain record of second-arbiter appeal outcomes for AgentScore.
/// @dev Additive and independent of AgentScoreRegistry, whose verdicts are final
///      and one-per-job. An appeal — re-adjudicated by a second, independent
///      arbiter on a different model family from the onchain record and the
///      stored deliverable — is recorded here instead. Data-only: never holds
///      funds, no payable/receive, transfers no tokens. It does NOT move or
///      reverse any ERC-8183 escrow (settlement there is final); it corrects the
///      reputation record. Unaudited testnet software.
contract AgentScoreAppeals is AccessControl {
    bytes32 public constant APPEAL_ARBITER_ROLE = keccak256("APPEAL_ARBITER_ROLE");

    /// @dev Mirrors AgentScoreRegistry.Outcome so original/final line up 1:1.
    enum Outcome {
        Approved,
        Rejected
    }

    struct Appeal {
        uint256 jobId;
        address agent;
        Outcome original; // the contested registry verdict
        Outcome result; // the appeal arbiter's decision (== original: upheld; != : overturned)
        bytes32 reasonHash; // keccak of the appeal arbiter's written reasoning
        address appealArbiter;
        uint64 resolvedAt;
    }

    mapping(uint256 jobId => Appeal appeal) private _appeals;
    /// @notice One appeal per ERC-8183 job id, ever.
    mapping(uint256 jobId => bool appealed) public jobAppealed;
    uint256[] private _jobIds;

    event AppealResolved(
        uint256 indexed jobId,
        address indexed agent,
        Outcome original,
        Outcome result,
        bool overturned,
        bytes32 reasonHash,
        address indexed appealArbiter
    );

    error JobAlreadyAppealed(uint256 jobId);
    error AgentZeroAddress();
    error NoAppeal(uint256 jobId);

    constructor(address initialAppealArbiter) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (initialAppealArbiter != address(0)) {
            _grantRole(APPEAL_ARBITER_ROLE, initialAppealArbiter);
        }
    }

    /// @notice Record a second-arbiter appeal outcome for an ERC-8183 job.
    ///         `original` is the contested registry verdict; `result` is the appeal
    ///         arbiter's decision (equal to original = upheld, different =
    ///         overturned). One appeal per job, ever.
    function resolveAppeal(uint256 jobId, address agent, Outcome original, Outcome result, bytes32 reasonHash)
        external
        onlyRole(APPEAL_ARBITER_ROLE)
    {
        if (agent == address(0)) revert AgentZeroAddress();
        if (jobAppealed[jobId]) revert JobAlreadyAppealed(jobId);
        jobAppealed[jobId] = true;

        _appeals[jobId] = Appeal({
            jobId: jobId,
            agent: agent,
            original: original,
            result: result,
            reasonHash: reasonHash,
            appealArbiter: msg.sender,
            resolvedAt: uint64(block.timestamp)
        });
        _jobIds.push(jobId);

        emit AppealResolved(jobId, agent, original, result, result != original, reasonHash, msg.sender);
    }

    function getAppeal(uint256 jobId) external view returns (Appeal memory) {
        if (!jobAppealed[jobId]) revert NoAppeal(jobId);
        return _appeals[jobId];
    }

    /// @notice True iff the job has an appeal whose result overturned the original verdict.
    function isOverturned(uint256 jobId) external view returns (bool) {
        return jobAppealed[jobId] && _appeals[jobId].result != _appeals[jobId].original;
    }

    function appealCount() external view returns (uint256) {
        return _jobIds.length;
    }

    function appealJobIdAt(uint256 index) external view returns (uint256) {
        return _jobIds[index];
    }
}

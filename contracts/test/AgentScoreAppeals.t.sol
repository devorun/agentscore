// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AgentScoreAppeals} from "../src/AgentScoreAppeals.sol";

contract AgentScoreAppealsTest is Test {
    event AppealResolved(
        uint256 indexed jobId,
        address indexed agent,
        AgentScoreAppeals.Outcome original,
        AgentScoreAppeals.Outcome result,
        bool overturned,
        bytes32 reasonHash,
        address indexed appealArbiter
    );

    AgentScoreAppeals internal appeals;

    address internal appealArbiter;
    address internal agent;
    address internal stranger;

    bytes32 internal constant REASON = keccak256("the appeal arbiter's written reasoning");

    function setUp() public {
        appealArbiter = makeAddr("appealArbiter");
        agent = makeAddr("agent");
        stranger = makeAddr("stranger");
        appeals = new AgentScoreAppeals(appealArbiter);
    }

    function test_ConstructorGrantsRoles() public view {
        assertTrue(appeals.hasRole(appeals.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(appeals.hasRole(appeals.APPEAL_ARBITER_ROLE(), appealArbiter));
        assertFalse(appeals.hasRole(appeals.APPEAL_ARBITER_ROLE(), stranger));
    }

    function test_ResolveOverturned_EmitsAndRecords() public {
        vm.expectEmit(true, true, true, true);
        emit AppealResolved(
            42,
            agent,
            AgentScoreAppeals.Outcome.Rejected,
            AgentScoreAppeals.Outcome.Approved,
            true,
            REASON,
            appealArbiter
        );
        vm.prank(appealArbiter);
        appeals.resolveAppeal(42, agent, AgentScoreAppeals.Outcome.Rejected, AgentScoreAppeals.Outcome.Approved, REASON);

        assertTrue(appeals.jobAppealed(42));
        assertTrue(appeals.isOverturned(42));
        assertEq(appeals.appealCount(), 1);
        assertEq(appeals.appealJobIdAt(0), 42);

        AgentScoreAppeals.Appeal memory a = appeals.getAppeal(42);
        assertEq(a.jobId, 42);
        assertEq(a.agent, agent);
        assertEq(uint256(a.original), uint256(AgentScoreAppeals.Outcome.Rejected));
        assertEq(uint256(a.result), uint256(AgentScoreAppeals.Outcome.Approved));
        assertEq(a.reasonHash, REASON);
        assertEq(a.appealArbiter, appealArbiter);
        assertEq(a.resolvedAt, uint64(block.timestamp));
    }

    function test_ResolveUpheld_NotOverturned() public {
        vm.prank(appealArbiter);
        appeals.resolveAppeal(7, agent, AgentScoreAppeals.Outcome.Rejected, AgentScoreAppeals.Outcome.Rejected, REASON);
        assertTrue(appeals.jobAppealed(7));
        assertFalse(appeals.isOverturned(7));
    }

    function test_OnlyAppealArbiterCanResolve() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, appeals.APPEAL_ARBITER_ROLE()
            )
        );
        vm.prank(stranger);
        appeals.resolveAppeal(1, agent, AgentScoreAppeals.Outcome.Rejected, AgentScoreAppeals.Outcome.Approved, REASON);
    }

    function test_OneAppealPerJob() public {
        vm.startPrank(appealArbiter);
        appeals.resolveAppeal(9, agent, AgentScoreAppeals.Outcome.Rejected, AgentScoreAppeals.Outcome.Approved, REASON);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreAppeals.JobAlreadyAppealed.selector, 9));
        appeals.resolveAppeal(9, agent, AgentScoreAppeals.Outcome.Rejected, AgentScoreAppeals.Outcome.Rejected, REASON);
        vm.stopPrank();
    }

    function test_RejectsZeroAgent() public {
        vm.expectRevert(AgentScoreAppeals.AgentZeroAddress.selector);
        vm.prank(appealArbiter);
        appeals.resolveAppeal(1, address(0), AgentScoreAppeals.Outcome.Rejected, AgentScoreAppeals.Outcome.Approved, REASON);
    }

    function test_GetAppeal_RevertsWhenNone() public {
        vm.expectRevert(abi.encodeWithSelector(AgentScoreAppeals.NoAppeal.selector, 123));
        appeals.getAppeal(123);
    }

    function test_IsOverturned_FalseWhenNoAppeal() public view {
        assertFalse(appeals.isOverturned(999));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AgentScoreRegistry} from "../src/AgentScoreRegistry.sol";

contract AgentScoreRegistryTest is Test {
    event AgentRegistered(address indexed agent, string name, string[] skillTags, string metadataURI);
    event AgentUpdated(address indexed agent, string name, string[] skillTags, string metadataURI);
    event VerdictAttested(
        uint256 indexed jobId,
        address indexed agent,
        AgentScoreRegistry.Outcome outcome,
        bytes32 reasonHash,
        address indexed arbiter
    );

    AgentScoreRegistry internal registry;

    address internal arbiter;
    address internal alice;
    address internal bob;
    address internal stranger;

    string[] internal tags;

    function setUp() public {
        arbiter = makeAddr("arbiter");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        stranger = makeAddr("stranger");
        registry = new AgentScoreRegistry(arbiter);
        tags.push("translation");
        tags.push("auditing");
    }

    function _register(address who, string memory name) internal {
        vm.prank(who);
        registry.registerAgent(name, tags, "ipfs://profile");
    }

    function _str(uint256 length) internal pure returns (string memory) {
        bytes memory raw = new bytes(length);
        for (uint256 i = 0; i < length; ++i) {
            raw[i] = "a";
        }
        return string(raw);
    }

    // ------------------------------------------------------------------
    // Roles
    // ------------------------------------------------------------------

    function test_DeployerIsAdmin_InitialArbiterHasRole() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(registry.hasRole(registry.ARBITER_ROLE(), arbiter));
    }

    function test_Constructor_ZeroArbiter_GrantsNoArbiterRole() public {
        AgentScoreRegistry fresh = new AgentScoreRegistry(address(0));
        assertFalse(fresh.hasRole(fresh.ARBITER_ROLE(), address(0)));
        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), address(this)));
    }

    function test_AdminCanGrantAndRevokeArbiterRole() public {
        bytes32 role = registry.ARBITER_ROLE();
        registry.grantRole(role, stranger);
        vm.prank(stranger);
        registry.attest(100, alice, AgentScoreRegistry.Outcome.Approved, keccak256("ok"));

        registry.revokeRole(role, stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role));
        registry.attest(101, alice, AgentScoreRegistry.Outcome.Approved, keccak256("ok"));
    }

    function test_NonAdminCannotGrantRoles() public {
        bytes32 arbiterRole = registry.ARBITER_ROLE();
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, adminRole));
        registry.grantRole(arbiterRole, alice);
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------

    function test_Register_StoresProfile() public {
        _register(alice, "Lexica");

        AgentScoreRegistry.AgentProfile memory profile = registry.getAgent(alice);
        assertEq(profile.name, "Lexica");
        assertEq(profile.metadataURI, "ipfs://profile");
        assertEq(profile.skillTags.length, 2);
        assertEq(profile.skillTags[0], "translation");
        assertEq(profile.registeredAt, uint64(block.timestamp));
        assertEq(profile.updatedAt, uint64(block.timestamp));
        assertTrue(registry.isRegistered(alice));
        assertEq(registry.agentCount(), 1);
        assertEq(registry.agentAt(0), alice);

        address[] memory all = registry.getAgents();
        assertEq(all.length, 1);
        assertEq(all[0], alice);
    }

    function test_Register_EmitsAgentRegistered() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentRegistered(alice, "Lexica", tags, "ipfs://profile");
        _register(alice, "Lexica");
    }

    function test_ReRegister_UpdatesProfile_EmitsAgentUpdated() public {
        _register(alice, "Lexica");
        uint64 firstRegisteredAt = registry.getAgent(alice).registeredAt;

        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentUpdated(alice, "Lexica v2", tags, "ipfs://profile");
        _register(alice, "Lexica v2");

        AgentScoreRegistry.AgentProfile memory profile = registry.getAgent(alice);
        assertEq(profile.name, "Lexica v2");
        assertEq(profile.registeredAt, firstRegisteredAt);
        assertEq(profile.updatedAt, uint64(block.timestamp));
        assertEq(registry.agentCount(), 1);
    }

    function test_ReRegister_CannotTouchAnotherAgentsProfile() public {
        _register(alice, "Lexica");
        _register(bob, "Lexica");

        assertEq(registry.getAgent(alice).name, "Lexica");
        assertEq(registry.getAgent(bob).name, "Lexica");
        assertEq(registry.agentCount(), 2);

        _register(bob, "Sentin");
        assertEq(registry.getAgent(alice).name, "Lexica");
        assertEq(registry.getAgent(bob).name, "Sentin");
    }

    function test_Register_AcceptsBoundaryLengths() public {
        _register(alice, _str(3));
        _register(bob, _str(32));
        assertEq(bytes(registry.getAgent(alice).name).length, 3);
        assertEq(bytes(registry.getAgent(bob).name).length, 32);
    }

    function test_Register_RevertsNameTooShort() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.NameLengthOutOfRange.selector, 2));
        registry.registerAgent(_str(2), tags, "");
    }

    function test_Register_RevertsNameTooLong() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.NameLengthOutOfRange.selector, 33));
        registry.registerAgent(_str(33), tags, "");
    }

    function test_Register_RevertsTooManySkillTags() public {
        string[] memory many = new string[](11);
        for (uint256 i = 0; i < many.length; ++i) {
            many[i] = "tag";
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.TooManySkillTags.selector, 11));
        registry.registerAgent("Lexica", many, "");
    }

    function test_Register_RevertsEmptyTag() public {
        string[] memory withEmpty = new string[](2);
        withEmpty[0] = "translation";
        withEmpty[1] = "";
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.TagLengthOutOfRange.selector, 1));
        registry.registerAgent("Lexica", withEmpty, "");
    }

    function test_Register_RevertsOversizedTag() public {
        string[] memory withLong = new string[](1);
        withLong[0] = _str(33);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.TagLengthOutOfRange.selector, 0));
        registry.registerAgent("Lexica", withLong, "");
    }

    function test_Register_RevertsOversizedMetadataURI() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.MetadataURITooLong.selector, 201));
        registry.registerAgent("Lexica", tags, _str(201));
    }

    // ------------------------------------------------------------------
    // Attestation
    // ------------------------------------------------------------------

    function test_Attest_RecordsVerdict() public {
        bytes32 reason = keccak256("deliverable matched spec");
        vm.prank(arbiter);
        registry.attest(42, alice, AgentScoreRegistry.Outcome.Approved, reason);

        AgentScoreRegistry.Verdict[] memory verdicts = registry.getVerdicts(alice);
        assertEq(verdicts.length, 1);
        assertEq(verdicts[0].jobId, 42);
        assertEq(verdicts[0].reasonHash, reason);
        assertEq(verdicts[0].arbiter, arbiter);
        assertEq(verdicts[0].attestedAt, uint64(block.timestamp));
        assertEq(uint8(verdicts[0].outcome), uint8(AgentScoreRegistry.Outcome.Approved));
        assertEq(registry.verdictCount(alice), 1);
        assertTrue(registry.jobAttested(42));
    }

    function test_Attest_EmitsVerdictAttested() public {
        bytes32 reason = keccak256("late delivery");
        vm.expectEmit(true, true, true, true, address(registry));
        emit VerdictAttested(7, bob, AgentScoreRegistry.Outcome.Rejected, reason, arbiter);
        vm.prank(arbiter);
        registry.attest(7, bob, AgentScoreRegistry.Outcome.Rejected, reason);
    }

    function test_Attest_WorksForUnregisteredAgent() public {
        assertFalse(registry.isRegistered(bob));
        vm.prank(arbiter);
        registry.attest(1, bob, AgentScoreRegistry.Outcome.Approved, keccak256("ok"));
        assertEq(registry.verdictCount(bob), 1);
    }

    function test_Attest_RevertsForNonArbiter() public {
        bytes32 role = registry.ARBITER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role));
        registry.attest(1, alice, AgentScoreRegistry.Outcome.Approved, keccak256("ok"));
    }

    function test_Attest_RevertsForAdminWithoutArbiterRole() public {
        bytes32 role = registry.ARBITER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), role)
        );
        registry.attest(1, alice, AgentScoreRegistry.Outcome.Approved, keccak256("ok"));
    }

    function test_Attest_RevertsOnDuplicateJobId() public {
        vm.startPrank(arbiter);
        registry.attest(9, alice, AgentScoreRegistry.Outcome.Approved, keccak256("ok"));
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.JobAlreadyAttested.selector, 9));
        registry.attest(9, bob, AgentScoreRegistry.Outcome.Rejected, keccak256("other"));
        vm.stopPrank();
    }

    function test_Attest_RevertsOnZeroAgent() public {
        vm.prank(arbiter);
        vm.expectRevert(AgentScoreRegistry.AgentZeroAddress.selector);
        registry.attest(1, address(0), AgentScoreRegistry.Outcome.Approved, keccak256("ok"));
    }

    // ------------------------------------------------------------------
    // No funds, ever
    // ------------------------------------------------------------------

    function test_RejectsNativeTransfers() public {
        vm.deal(address(this), 1 ether);
        (bool plainOk,) = address(registry).call{value: 1}("");
        assertFalse(plainOk);

        vm.deal(arbiter, 1 ether);
        vm.prank(arbiter);
        (bool fnOk,) = address(registry).call{value: 1}(
            abi.encodeCall(registry.attest, (1, alice, AgentScoreRegistry.Outcome.Approved, keccak256("ok")))
        );
        assertFalse(fnOk);
        assertEq(address(registry).balance, 0);
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    function testFuzz_Register_ValidInputsStored(uint8 nameSeed, uint8 uriSeed) public {
        uint256 nameLength = bound(uint256(nameSeed), 3, 32);
        uint256 uriLength = bound(uint256(uriSeed), 0, 200);

        vm.prank(alice);
        registry.registerAgent(_str(nameLength), tags, _str(uriLength));

        AgentScoreRegistry.AgentProfile memory profile = registry.getAgent(alice);
        assertEq(bytes(profile.name).length, nameLength);
        assertEq(bytes(profile.metadataURI).length, uriLength);
    }

    function testFuzz_Register_OversizedNameReverts(uint16 lengthSeed) public {
        uint256 nameLength = bound(uint256(lengthSeed), 33, 500);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.NameLengthOutOfRange.selector, nameLength));
        registry.registerAgent(_str(nameLength), tags, "");
    }

    function testFuzz_Register_ShortNameReverts(uint8 lengthSeed) public {
        uint256 nameLength = bound(uint256(lengthSeed), 0, 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.NameLengthOutOfRange.selector, nameLength));
        registry.registerAgent(_str(nameLength), tags, "");
    }

    function testFuzz_Attest_RecordsAndBlocksDuplicates(uint256 jobId, address agent, bool approved, bytes32 reason)
        public
    {
        vm.assume(agent != address(0));
        AgentScoreRegistry.Outcome outcome =
            approved ? AgentScoreRegistry.Outcome.Approved : AgentScoreRegistry.Outcome.Rejected;

        vm.prank(arbiter);
        registry.attest(jobId, agent, outcome, reason);
        assertEq(registry.verdictCount(agent), 1);
        assertTrue(registry.jobAttested(jobId));

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(AgentScoreRegistry.JobAlreadyAttested.selector, jobId));
        registry.attest(jobId, agent, outcome, reason);
    }
}

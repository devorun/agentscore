// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {AgentScoreAppeals} from "../src/AgentScoreAppeals.sol";

/// @notice Deploys AgentScoreAppeals to Arc Testnet. The appeal-arbiter address
///         comes from the APPEAL_ARBITER_ADDRESS environment variable; the
///         deployer key is supplied on the command line and never stored here.
///         This deploy is additive — it does not touch AgentScoreRegistry.
contract DeployAgentScoreAppeals is Script {
    function run() external returns (AgentScoreAppeals appeals) {
        address appealArbiter = vm.envAddress("APPEAL_ARBITER_ADDRESS");
        vm.startBroadcast();
        appeals = new AgentScoreAppeals(appealArbiter);
        vm.stopBroadcast();
    }
}

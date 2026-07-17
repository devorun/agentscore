// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {AgentScoreRegistry} from "../src/AgentScoreRegistry.sol";

/// @notice Deploys AgentScoreRegistry to Arc Testnet. The arbiter address comes
///         from the ARBITER_ADDRESS environment variable; the deployer key is
///         supplied on the command line at deploy time and never stored here.
contract DeployAgentScoreRegistry is Script {
    function run() external returns (AgentScoreRegistry registry) {
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        vm.startBroadcast();
        registry = new AgentScoreRegistry(arbiter);
        vm.stopBroadcast();
    }
}

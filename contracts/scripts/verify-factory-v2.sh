#!/usr/bin/env bash
set -euo pipefail

deployment_file="${1:-deployments/robinhood-mainnet-v2.json}"
rpc_url="${RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
verifier_url="${VERIFIER_URL:-https://robinhoodchain.blockscout.com/api/}"

if [[ ! -f "$deployment_file" ]]; then
  echo "missing deployment receipt: $deployment_file" >&2
  exit 1
fi

factory="$(jq -r '.factory' "$deployment_file")"
market="$(jq -r '.keyMarketplace' "$deployment_file")"
adapter="$(jq -r '.nvdaAdapter' "$deployment_file")"
bond="$(jq -r '.agentBond' "$deployment_file")"
router="$(jq -r '.revenueRouter' "$deployment_file")"
deployer="$(jq -r '.deployer' "$deployment_file")"
safe="$(jq -r '.owner' "$deployment_file")"
minimum="$(jq -r '.minimumMuppetsRaw' "$deployment_file")"
legacy_factory="$(jq -r '.legacyFactory' "$deployment_file")"
policy="$(jq -r '.policyExecutor' "$deployment_file")"
reserve="$(jq -r '.feeRwaReserve' "$deployment_file")"
muppets="$(jq -r '.muppetsToken' "$deployment_file")"
weth="$(jq -r '.WETH // "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"' "$deployment_file")"
pons_fee_escrow="$(jq -r '.ponsFeeEscrow' "$deployment_file")"

factory_args="$(cast abi-encode \
  'constructor(address,address,address,uint256,address,address,address)' \
  "$deployer" "$muppets" "$bond" "$minimum" "$policy" "$market" "$legacy_factory")"
market_args="$(cast abi-encode 'constructor(address,address,uint16)' "$deployer" "$router" 300)"
bond_args="$(cast abi-encode \
  'constructor(address,address,address,uint256,uint40)' \
  "$deployer" "$muppets" "$weth" "$minimum" 2592000)"
router_args="$(cast abi-encode \
  'constructor(address,address,address,address,address,address)' \
  "$deployer" "$pons_fee_escrow" "$weth" "$bond" "$reserve" "$safe")"
adapter_args="$(cast abi-encode \
  'constructor(address,address,address,address,int24,uint16,uint32,uint256)' \
  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 \
  0x6F81790Ebac25497be379Dc66143fb298663Ae11 \
  0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 \
  0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 \
  1200 300 259200 10000000)"

forge verify-contract "$market" src/KeyMarketplace.sol:KeyMarketplace \
  --chain-id 4663 --rpc-url "$rpc_url" --verifier blockscout --verifier-url "$verifier_url" \
  --constructor-args "$market_args" --watch
forge verify-contract "$adapter" src/adapters/EZManagerPoolAdapter.sol:EZManagerPoolAdapter \
  --chain-id 4663 --rpc-url "$rpc_url" --verifier blockscout --verifier-url "$verifier_url" \
  --constructor-args "$adapter_args" --watch
forge verify-contract "$bond" src/MuppetAgentBond.sol:MuppetAgentBond \
  --chain-id 4663 --rpc-url "$rpc_url" --verifier blockscout --verifier-url "$verifier_url" \
  --constructor-args "$bond_args" --watch
forge verify-contract "$router" src/MuppetRevenueRouter.sol:MuppetRevenueRouter \
  --chain-id 4663 --rpc-url "$rpc_url" --verifier blockscout --verifier-url "$verifier_url" \
  --constructor-args "$router_args" --watch
forge verify-contract "$factory" src/LiquidMuppetsFactoryV2.sol:LiquidMuppetsFactoryV2 \
  --chain-id 4663 --rpc-url "$rpc_url" --verifier blockscout --verifier-url "$verifier_url" \
  --constructor-args "$factory_args" --watch

owner="$(cast call "$factory" 'owner()(address)' --rpc-url "$rpc_url")"
enabled="$(cast call "$factory" 'launchesEnabled()(bool)' --rpc-url "$rpc_url")"
bond_owner="$(cast call "$bond" 'owner()(address)' --rpc-url "$rpc_url")"
router_owner="$(cast call "$router" 'owner()(address)' --rpc-url "$rpc_url")"
bond_paused="$(cast call "$bond" 'paused()(bool)' --rpc-url "$rpc_url")"
router_paused="$(cast call "$router" 'paused()(bool)' --rpc-url "$rpc_url")"
if [[ "${owner,,}" != "${safe,,}" ]]; then
  echo "factory owner does not match the recorded Safe" >&2
  exit 1
fi
if [[ "$enabled" != "false" ]]; then
  echo "launches were enabled before post-verification review" >&2
  exit 1
fi
if [[ "${bond_owner,,}" != "${safe,,}" || "${router_owner,,}" != "${safe,,}" ]]; then
  echo "revenue contract owner does not match the recorded Safe" >&2
  exit 1
fi
if [[ "$bond_paused" != "true" || "$router_paused" != "true" ]]; then
  echo "revenue contracts were activated before post-verification review" >&2
  exit 1
fi

echo "verification complete"
echo "Pons creator target: 0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
echo "Pons creator calldata to direct fees to the router: $(cast calldata 'setCreatorFeeRecipient(bytes32,address)' 0x917d90894a647c3cb4f7bad482a1b3276f643f69a36278371acbf4afaa16b128 "$router")"
echo "Pons creator calldata to enable the built-in buyback: $(cast calldata 'setBuybackEnabled(bytes32,bool)' 0x917d90894a647c3cb4f7bad482a1b3276f643f69a36278371acbf4afaa16b128 true)"
echo "Safe target: $bond"
echo "Safe calldata to activate Agent Bonds after review: $(cast calldata 'activate()')"
echo "Safe target: $router"
echo "Safe calldata to activate revenue routing after Pons setup: $(cast calldata 'activate()')"
echo "Safe target: $factory"
echo "Safe calldata to activate launches after review: $(cast calldata 'setLaunchesEnabled(bool)' true)"

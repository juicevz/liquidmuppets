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
deployer="$(jq -r '.deployer' "$deployment_file")"
safe="$(jq -r '.owner' "$deployment_file")"
minimum="$(jq -r '.minimumMuppetsRaw' "$deployment_file")"
legacy_factory="$(jq -r '.legacyFactory' "$deployment_file")"
policy="$(jq -r '.policyExecutor' "$deployment_file")"
reserve="$(jq -r '.feeRwaReserve' "$deployment_file")"
muppets="$(jq -r '.muppetsToken' "$deployment_file")"

factory_args="$(cast abi-encode \
  'constructor(address,address,uint256,address,address,address)' \
  "$deployer" "$muppets" "$minimum" "$policy" "$market" "$legacy_factory")"
market_args="$(cast abi-encode 'constructor(address,address,uint16)' "$deployer" "$reserve" 300)"
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
forge verify-contract "$factory" src/LiquidMuppetsFactoryV2.sol:LiquidMuppetsFactoryV2 \
  --chain-id 4663 --rpc-url "$rpc_url" --verifier blockscout --verifier-url "$verifier_url" \
  --constructor-args "$factory_args" --watch

owner="$(cast call "$factory" 'owner()(address)' --rpc-url "$rpc_url")"
enabled="$(cast call "$factory" 'launchesEnabled()(bool)' --rpc-url "$rpc_url")"
if [[ "${owner,,}" != "${safe,,}" ]]; then
  echo "factory owner does not match the recorded Safe" >&2
  exit 1
fi
if [[ "$enabled" != "false" ]]; then
  echo "launches were enabled before post-verification review" >&2
  exit 1
fi

echo "verification complete"
echo "Safe target: $factory"
echo "Safe calldata to activate launches after review: $(cast calldata 'setLaunchesEnabled(bool)' true)"

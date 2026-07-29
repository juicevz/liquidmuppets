from __future__ import annotations

import argparse
import json
import os

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct


def main() -> None:
    parser = argparse.ArgumentParser(description="Claim a LiquidMuppets app handle with a wallet signature.")
    parser.add_argument("--base-url", default="https://liquidmuppets.io")
    parser.add_argument("--handle", required=True)
    args = parser.parse_args()

    account = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"])
    root = args.base_url.rstrip("/")
    with httpx.Client(timeout=20) as client:
        challenge_response = client.post(
            f"{root}/api/v1/profiles/challenge",
            json={"wallet": account.address, "handle": args.handle},
        )
        challenge_response.raise_for_status()
        challenge = challenge_response.json()
        signature = Account.sign_message(
            encode_defunct(text=str(challenge["message"])), account.key
        ).signature.hex()
        claim_response = client.post(
            f"{root}/api/v1/profiles/claim",
            json={
                "wallet": account.address,
                "handle": args.handle,
                "nonce": challenge["nonce"],
                "signature": signature,
            },
        )
        claim_response.raise_for_status()
        profile = claim_response.json()
    print(json.dumps({"wallet": profile["wallet"], "handle": profile["handle"]}))


if __name__ == "__main__":
    main()

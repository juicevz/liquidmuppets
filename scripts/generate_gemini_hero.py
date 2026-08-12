#!/usr/bin/env python3
"""Generate the MUPPETS landing hero through Gemini without persisting secrets."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


PROMPT = """Use case: stylized-concept
Asset type: full-bleed 16:9 website hero background for MUPPETS, an onchain agent economy
Primary request: Create an original lucid-meadow dreamscape that feels like a recovered late-1990s nature photograph slowly becoming a precise early-digital world. It must feel distinct from retro-futurist painted city imagery.
Scene/backdrop: A saturated cobalt-blue open sky with two or three monumental, naturally shaped white cumulus clouds over a vivid rolling green wildflower meadow. Near the bottom and outer edges only, real blades and tiny flowers gradually resolve into restrained square pixel mosaics, as if the physical meadow is being compiled. Three nearly invisible pearl-white thread lines descend from separate clouds and gently disappear among the flowers, a quiet puppet-control motif rather than literal strings.
Subject: Landscape only. No people, creatures, mascots, buildings, machines, portals, arches, rings, discs, planets or monuments.
Style/medium: high-resolution editorial dreamcore landscape; photographic sky and grass with subtle analog scan grain, gentle halation and tactile color; only the lowest foreground has refined pixel breakup. Not Minecraft, not voxel art, not anime, not fantasy concept art.
Composition/framing: cinematic 16:9, low meadow horizon around 58 percent of frame, huge sky, visual detail around the edges, a calm uncluttered central column for three overlaid pixel characters and centered website copy. Preserve useful detail in the central crop for mobile. No single central figure or focal object.
Lighting/mood: clear late-morning light, joyous but slightly uncanny, crisp whites, deep blue sky, luminous greens, small pink/yellow/blue flowers. Natural depth and very high micro-detail without glossy CGI.
Constraints: truly original composition; premium 4K landing-page quality; no text, logo, UI, border, watermark or frame; no imitation of an existing website hero.
Avoid: retro-future cities, golden arches, giant rings, floating platforms, pastoral person facing a horizon, dark cinematic sci-fi, muddy beige palette, low-resolution blur, overdone bloom, obvious AI symmetry.
"""


def find_image_block(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        data = value.get("data")
        mime = value.get("mime_type") or value.get("mimeType")
        kind = value.get("type")
        if isinstance(data, str) and (kind == "image" or (isinstance(mime, str) and mime.startswith("image/"))):
            return value
        direct = value.get("output_image")
        if isinstance(direct, dict) and isinstance(direct.get("data"), str):
            return direct
        for child in value.values():
            found = find_image_block(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_image_block(child)
            if found:
                return found
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="gemini-3-pro-image")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY was not injected", file=sys.stderr)
        return 2

    payload = {
        "model": args.model,
        "input": [{"type": "text", "text": PROMPT}],
        "response_format": {
            "type": "image",
            "mime_type": "image/jpeg",
            "aspect_ratio": "16:9",
            "image_size": "4K",
        },
    }
    request = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"Gemini HTTP {error.code}: {body[:1400]}", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001
        print(f"Gemini request failed: {error}", file=sys.stderr)
        return 1

    image = find_image_block(result)
    if not image:
        print(f"No generated image in response. Top-level keys: {sorted(result.keys())}", file=sys.stderr)
        return 1

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(base64.b64decode(image["data"]))
    print(f"saved={output}")
    print(f"model={args.model}")
    print(f"bytes={output.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

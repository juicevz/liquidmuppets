# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime
from html import escape
from io import BytesIO
from pathlib import Path
from textwrap import wrap

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse
from PIL import Image, ImageDraw, ImageFont
from web3 import Web3

from app.schemas import ProofCard, ProofKind, ProofListResponse

api_router = APIRouter(tags=["proof cards"])
share_router = APIRouter(tags=["proof share pages"])


@api_router.get("/proofs", response_model=ProofListResponse)
def list_proofs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    kind: ProofKind | None = None,
    creator: str | None = None,
    agent_id: int | None = Query(default=None, ge=0),
) -> ProofListResponse:
    if creator is not None and not Web3.is_address(creator):
        raise HTTPException(status_code=422, detail="invalid creator wallet")
    items = request.app.state.proofs.list_proofs(
        limit=limit,
        kind=kind,
        creator=Web3.to_checksum_address(creator) if creator else None,
        agent_id=agent_id,
    )
    return ProofListResponse.model_validate(
        {
            "generated_at": datetime.now(UTC).isoformat(),
            "boundary": request.app.state.proofs_boundary,
            "items": items,
        }
    )


@api_router.get("/proofs/{proof_id}/card.svg")
def proof_card_image(proof_id: str, request: Request) -> Response:
    proof = _get_proof(request, proof_id)
    return Response(
        content=_render_svg(proof),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff"},
    )


@api_router.get("/proofs/{proof_id}/card.png")
def proof_card_social_image(proof_id: str, request: Request) -> Response:
    proof = _get_proof(request, proof_id)
    return Response(
        content=_render_png(proof),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff"},
    )


@api_router.get("/proofs/{proof_id}", response_model=ProofCard)
def proof_card(proof_id: str, request: Request) -> ProofCard:
    return _get_proof(request, proof_id)


@share_router.get("/proof/{proof_id}", response_class=HTMLResponse)
def proof_share_page(proof_id: str, request: Request) -> HTMLResponse:
    proof = _get_proof(request, proof_id)
    return HTMLResponse(
        content=_render_share_page(proof),
        headers={"Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff"},
    )


def _get_proof(request: Request, proof_id: str) -> ProofCard:
    result = request.app.state.proofs.get_proof(proof_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Proof card not found")
    return ProofCard.model_validate(result)


def _render_svg(proof: ProofCard) -> str:
    title_lines = wrap(proof.title, width=36, break_long_words=False, break_on_hyphens=False)[:2] or [proof.title]
    summary_lines = wrap(proof.summary, width=72, break_long_words=False, break_on_hyphens=False)[:3]
    title_svg = "".join(
        f'<text x="74" y="{178 + index * 58}" class="title">{escape(line)}</text>'
        for index, line in enumerate(title_lines)
    )
    summary_start = 315 if len(title_lines) > 1 else 268
    summary_svg = "".join(
        f'<text x="74" y="{summary_start + index * 31}" class="summary">{escape(line)}</text>'
        for index, line in enumerate(summary_lines)
    )
    pool = proof.market.pool or proof.market.market_id or "no external pool"
    receipt = _short_identifier(proof.receipt.tx_hash) if proof.receipt.tx_hash else "NO TRANSACTION SIGNED"
    range_label = _range_label(proof)
    timestamp = proof.timestamp.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    token_address = proof.token_address or "token address unavailable"
    asset_address = proof.asset.address or "asset address unavailable"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">{escape(proof.title)}</title>
  <desc id="desc">{escape(proof.summary)}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07110f"/><stop offset="1" stop-color="#15231d"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#51f4b0" stop-opacity=".24"/><stop offset="1" stop-color="#51f4b0" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="#dfffee" stroke-opacity=".045"/></pattern>
    <style>
      text{{font-family:Inter,Arial,sans-serif;fill:#f2f8f4}}.mono{{font-family:monospace}}.tiny{{font-size:15px;letter-spacing:2px;fill:#83a596}}.title{{font-size:52px;font-weight:700;letter-spacing:-1.8px}}.summary{{font-size:23px;fill:#b6c9c0}}.label{{font-size:14px;letter-spacing:1.6px;fill:#6e9182}}.value{{font-size:19px;font-weight:600}}.address{{font-size:16px;fill:#c8dbd2}}.pool{{font-size:10px;fill:#c8dbd2}}
    </style>
  </defs>
  <rect width="1200" height="630" rx="0" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#grid)"/><circle cx="1060" cy="86" r="330" fill="url(#glow)"/>
  <rect x="38" y="38" width="1124" height="554" rx="26" fill="none" stroke="#a8d2bf" stroke-opacity=".24"/>
  <circle cx="74" cy="80" r="7" fill="#51f4b0"/><text x="94" y="86" class="tiny mono">LIQUIDMUPPETS / PUBLIC PROOF</text>
  <rect x="880" y="61" width="240" height="38" rx="19" fill="#51f4b0" fill-opacity=".10" stroke="#51f4b0" stroke-opacity=".45"/><text x="1000" y="85" text-anchor="middle" class="tiny mono">{escape(proof.category_label.upper())}</text>
  {title_svg}{summary_svg}
  <line x1="74" x2="1126" y1="410" y2="410" stroke="#dfffee" stroke-opacity=".14"/>
  <text x="74" y="449" class="label mono">MUPPET</text><text x="74" y="480" class="value">{escape(proof.subject.name)}</text>
  <text x="355" y="449" class="label mono">ASSET / POOL</text><text x="355" y="470" class="value">{escape(proof.asset.symbol)}</text><text x="355" y="485" class="pool mono">ASSET {escape(asset_address)}</text><text x="355" y="499" class="pool mono">POOL {escape(pool)}</text>
  <text x="900" y="449" class="label mono">HEALTH</text><text x="900" y="480" class="value">{escape(proof.market.health_status)}</text>
  <text x="74" y="529" class="label mono">TIME</text><text x="74" y="558" class="value mono">{escape(timestamp)}</text>
  <text x="355" y="529" class="label mono">RECEIPT</text><text x="355" y="558" class="address mono">{escape(receipt)}</text>
  <text x="700" y="529" class="label mono">RANGE</text><text x="700" y="558" class="address mono">{escape(range_label)}</text>
  <text x="74" y="582" class="label mono">${escape(proof.token_symbol)} CA</text><text x="212" y="582" class="address mono">{escape(token_address)}</text>
</svg>'''


def _render_png(proof: ProofCard) -> bytes:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), "#07110f")
    draw = ImageDraw.Draw(image)
    for y in range(height):
        blend = y / max(1, height - 1)
        draw.line((0, y, width, y), fill=(7 + int(14 * blend), 17 + int(18 * blend), 15 + int(14 * blend)))
    for x in range(0, width, 38):
        draw.line((x, 0, x, height), fill="#14231d", width=1)
    for y in range(0, height, 38):
        draw.line((0, y, width, y), fill="#14231d", width=1)
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((820, -250, 1380, 310), fill=(81, 244, 176, 24))
    image = Image.alpha_composite(image.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(image)

    mono_small = _font(15, mono=True)
    mono_label = _font(14, mono=True)
    body = _font(23)
    value = _font(19, bold=True)
    title_font = _font(52, bold=True)
    address_font = _font(16, mono=True)
    pool_font = _font(10, mono=True)
    draw.rounded_rectangle((38, 38, 1162, 592), radius=26, outline="#385648", width=2)
    draw.ellipse((67, 73, 81, 87), fill="#51f4b0")
    draw.text((94, 68), "LIQUIDMUPPETS / PUBLIC PROOF", font=mono_small, fill="#83a596")

    category = proof.category_label.upper()
    category_width = draw.textlength(category, font=mono_small)
    pill_left = max(820, 1126 - int(category_width) - 36)
    draw.rounded_rectangle((pill_left, 61, 1126, 99), radius=19, fill="#102b20", outline="#39785d", width=1)
    draw.text(((pill_left + 1126 - category_width) / 2, 68), category, font=mono_small, fill="#9af4c6")

    title_lines = _fit_lines(draw, proof.title, title_font, 1020, 2)
    for index, line in enumerate(title_lines):
        draw.text((74, 145 + index * 58), line, font=title_font, fill="#f2f8f4")
    summary_y = 274 if len(title_lines) == 1 else 326
    for index, line in enumerate(_fit_lines(draw, proof.summary, body, 990, 2)):
        draw.text((74, summary_y + index * 31), line, font=body, fill="#b6c9c0")

    draw.line((74, 404, 1126, 404), fill="#29483b", width=1)
    pool = proof.market.pool or proof.market.market_id or "no external pool"
    receipt = _short_identifier(proof.receipt.tx_hash) if proof.receipt.tx_hash else "NO TRANSACTION SIGNED"
    range_label = _range_label(proof)
    timestamp = proof.timestamp.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    asset_address = proof.asset.address or "asset address unavailable"
    fields = [
        (74, 425, "MUPPET", proof.subject.name, 245),
        (850, 425, "HEALTH", proof.market.health_status, 270),
        (74, 505, "TIME", timestamp, 245),
        (355, 505, "RECEIPT", receipt, 310),
        (700, 505, "RANGE", range_label, 420),
    ]
    draw.text((355, 425), "ASSET / POOL", font=mono_label, fill="#6e9182")
    draw.text((355, 447), proof.asset.symbol, font=value, fill="#f2f8f4")
    draw.text((355, 471), f"ASSET {asset_address}", font=pool_font, fill="#c8dbd2")
    draw.text((355, 486), f"POOL {pool}", font=pool_font, fill="#c8dbd2")
    for x, y, label, field_value, max_width in fields:
        draw.text((x, y), label, font=mono_label, fill="#6e9182")
        draw.text((x, y + 27), _clip_text(draw, field_value, value, max_width), font=value, fill="#f2f8f4")

    token_address = proof.token_address or "token address unavailable"
    draw.text((74, 566), f"${proof.token_symbol} CA", font=mono_label, fill="#6e9182")
    draw.text((212, 564), _clip_text(draw, token_address, address_font, 900), font=address_font, fill="#c8dbd2")
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def _font(
    size: int,
    *,
    bold: bool = False,
    mono: bool = False,
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    filename = "DejaVuSansMono.ttf" if mono else "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    path = Path("/usr/share/fonts/truetype/dejavu") / filename
    try:
        return ImageFont.truetype(str(path), size=size)
    except OSError:
        return ImageFont.load_default(size=size)


def _fit_lines(
    draw: ImageDraw.ImageDraw,
    value: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
    max_lines: int,
) -> list[str]:
    words = value.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words.pop(0)
    while words:
        candidate = f"{current} {words[0]}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            words.pop(0)
            continue
        lines.append(current)
        current = words.pop(0)
        if len(lines) == max_lines - 1:
            current = f"{current} {' '.join(words)}".strip()
            words.clear()
            break
    lines.append(current)
    return [_clip_text(draw, line, font, max_width) for line in lines[:max_lines]]


def _clip_text(
    draw: ImageDraw.ImageDraw,
    value: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
) -> str:
    if draw.textlength(value, font=font) <= max_width:
        return value
    clipped = value
    while clipped and draw.textlength(f"{clipped}…", font=font) > max_width:
        clipped = clipped[:-1]
    return f"{clipped.rstrip()}…"


def _short_identifier(value: str | None) -> str:
    if value is None or len(value) <= 24:
        return value or ""
    return f"{value[:12]}…{value[-10:]}"


def _range_label(proof: ProofCard) -> str:
    if proof.market.range is None:
        return "not used for this task"
    return (
        f"ticks {proof.market.range.lower_tick} to {proof.market.range.upper_tick}, "
        f"current {proof.market.range.current_tick}"
    )


def _render_share_page(proof: ProofCard) -> str:
    title = escape(proof.title)
    description = escape(proof.summary)
    public_url = escape(proof.public_url, quote=True)
    image_url = escape(proof.image_url, quote=True)
    app_url = escape(proof.app_url, quote=True)
    receipt_url = escape(proof.receipt.url, quote=True) if proof.receipt.url else None
    pool = escape(proof.market.pool or proof.market.market_id or "no external pool")
    range_label = escape(_range_label(proof))
    asset_address = escape(proof.asset.address or "asset address unavailable")
    token_address = escape(proof.token_address or "token address unavailable")
    receipt_link = (
        f'<a href="{receipt_url}" target="_blank" rel="noreferrer">open transaction receipt</a>'
        if receipt_url
        else '<span>no transaction was signed for this record</span>'
    )
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} | LiquidMuppets proof</title><meta name="description" content="{description}">
<link rel="canonical" href="{public_url}"><meta property="og:type" content="article"><meta property="og:url" content="{public_url}">
<meta property="og:title" content="{title}"><meta property="og:description" content="{description}"><meta property="og:image" content="{image_url}"><meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}"><meta name="twitter:description" content="{description}"><meta name="twitter:image" content="{image_url}">
<style>*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;background:#07110f;color:#edf7f1;font:16px/1.5 Inter,Arial,sans-serif;padding:28px}}main{{max-width:1040px;margin:auto}}.top{{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:22px}}.brand{{font:12px monospace;letter-spacing:2px;color:#79e8b4}}a{{color:#a6f5ce}}.card{{position:relative;overflow:hidden;border:1px solid #29483b;border-radius:24px;background:linear-gradient(145deg,#0b1713,#15231d);padding:42px;box-shadow:0 28px 90px #0008}}.card:after{{content:'';position:absolute;width:420px;height:420px;border-radius:50%;background:#3aff9d18;filter:blur(20px);right:-190px;top:-220px}}small{{font:11px monospace;letter-spacing:1.5px;text-transform:uppercase;color:#769889}}h1{{font-size:clamp(38px,7vw,74px);line-height:.98;letter-spacing:-3px;max-width:850px;margin:20px 0}}.summary{{font-size:20px;color:#afc5ba;max-width:780px}}dl{{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#29483b;margin:34px 0 0;border:1px solid #29483b}}dl div{{background:#0d1915;padding:17px;min-width:0}}dt{{font:10px monospace;letter-spacing:1px;color:#6e9182;text-transform:uppercase}}dd{{margin:8px 0 0;font-weight:650;overflow-wrap:anywhere}}code{{display:block;margin-top:26px;color:#bed4c9;overflow-wrap:anywhere}}.reason{{border-left:2px solid #51f4b0;padding:12px 16px;background:#51f4b00b}}.actions{{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}}.actions a{{padding:11px 17px;border:1px solid #3c6554;border-radius:999px;text-decoration:none}}footer{{margin-top:20px;color:#77988a;font-size:13px}}@media(max-width:700px){{body{{padding:14px}}.card{{padding:24px}}h1{{letter-spacing:-1.5px}}dl{{grid-template-columns:1fr}}}}</style></head>
<body><main><div class="top"><span class="brand">● LIQUIDMUPPETS / PUBLIC PROOF</span><a href="{app_url}">open in app</a></div>
<article class="card"><small>{escape(proof.category_label)}</small><h1>{title}</h1><p class="summary">{description}</p>
<p class="reason">{escape(proof.reason or proof.boundary)}</p><dl><div><dt>Muppet</dt><dd>{escape(proof.subject.name)}</dd></div><div><dt>asset</dt><dd>{escape(proof.asset.symbol)}<br>{asset_address}</dd></div><div><dt>health</dt><dd>{escape(proof.market.health_status)}</dd></div><div><dt>venue</dt><dd>{escape(proof.market.venue)}</dd></div><div><dt>pool or market</dt><dd>{pool}</dd></div><div><dt>range</dt><dd>{range_label}</dd></div><div><dt>timestamp</dt><dd>{escape(proof.timestamp.isoformat())}</dd></div></dl>
<code>${escape(proof.token_symbol)} CA: {token_address}</code><div class="actions">{receipt_link}<a href="{image_url}">open generated card</a></div></article><footer>{escape(proof.boundary)}</footer></main></body></html>'''

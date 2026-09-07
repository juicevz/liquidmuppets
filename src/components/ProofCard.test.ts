import { describe, expect, it } from 'vitest'
import type { ProofRecord } from '../lib/api'
import { proofShareHref } from './ProofCard'

const proof = {
  id: 'muppet-launch-example123',
  kind: 'muppet_launch',
  category_label: 'Muppet launch',
  title: 'morpho frog launched',
  summary: 'Muppet #0 entered the public record.',
  timestamp: '2026-09-07T12:00:00Z',
  action: 'launched',
  reason: null,
  event_count: 1,
  subject: {
    agent_id: 0,
    name: 'morpho frog',
    pet_id: 5,
    creator: '0x1111111111111111111111111111111111111111',
    performance_url: '/app/muppet/0',
  },
  asset: { symbol: 'USDG', address: '0x2222222222222222222222222222222222222222' },
  market: {
    venue: 'Morpho Blue',
    pair: 'USDe / USDG',
    pool: null,
    market_id: '0xmarket',
    range: null,
    health_status: 'healthy',
    health_detail: 'The configured market gates pass.',
    observed_at: '2026-09-07T12:00:00Z',
  },
  receipt: {
    state: 'confirmed',
    tx_hash: `0x${'a'.repeat(64)}`,
    url: `https://robinhoodchain.blockscout.com/tx/0x${'a'.repeat(64)}`,
    block_number: 123,
  },
  facts: [],
  token_symbol: 'MUPPETS',
  token_address: '0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189',
  public_url: 'https://liquidmuppets.io/proof/muppet-launch-example123',
  app_url: 'https://liquidmuppets.io/app/proof/muppet-launch-example123',
  image_url: 'https://liquidmuppets.io/api/v1/proofs/muppet-launch-example123/card.png',
  share_text: 'morpho frog launched\n\nMuppet #0 entered the public record.',
  boundary: 'Recorded evidence only. No projected or annualized APY.',
  no_apy_projection: true,
} satisfies ProofRecord

describe('Proof Card sharing', () => {
  it('prepares the durable public proof URL for X', () => {
    const url = new URL(proofShareHref(proof))

    expect(url.origin + url.pathname).toBe('https://x.com/intent/post')
    expect(url.searchParams.get('text')).toBe(proof.share_text)
    expect(url.searchParams.get('url')).toBe(proof.public_url)
  })
})

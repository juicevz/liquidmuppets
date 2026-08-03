import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await mkdir(new URL('./canopy-reference/', import.meta.url), { recursive: true })
await page.goto('https://canopyfinance.io/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(4_000)

const metrics = await page.evaluate(() => {
  const animations = document.getAnimations().map((animation) => {
    const timing = animation.effect?.getTiming()
    return timing ? { duration: timing.duration, delay: timing.delay, easing: timing.easing } : null
  }).filter(Boolean)
  const topLevel = [...document.body.children].map((node) => ({
    tag: node.tagName,
    className: node.className,
    height: node.getBoundingClientRect().height,
  }))
  return {
    title: document.title,
    scrollHeight: document.documentElement.scrollHeight,
    fontFamily: getComputedStyle(document.body).fontFamily,
    background: getComputedStyle(document.body).backgroundColor,
    animationTimings: [...new Map(animations.map((item) => [JSON.stringify(item), item])).values()],
    topLevel,
  }
})

const positions = [0, 700, 1400, 2200, 3200, 4600, 6200]
for (const position of positions) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), position)
  await page.waitForTimeout(850)
  await page.screenshot({
    path: new URL(`./canopy-reference/scroll-${String(position).padStart(4, '0')}.png`, import.meta.url).pathname,
    fullPage: false,
  })
}

console.log(JSON.stringify(metrics, null, 2))
await browser.close()

import { chromium } from 'playwright'

const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? process.env.MUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
await page.addInitScript(() => window.localStorage.setItem('liquidmuppets-handle', '@visualqa'))
await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto' })

for (const [index, progress] of [0.12, 0.375, 0.625, 0.875].entries()) {
  await page.evaluate((targetProgress) => {
    const story = document.querySelector('.story-book-section')
    if (!(story instanceof HTMLElement)) return
    const travel = Math.max(1, story.offsetHeight - window.innerHeight * 0.72)
    const storyTop = story.getBoundingClientRect().top + window.scrollY
    const target = storyTop - window.innerHeight * 0.12 + travel * targetProgress
    window.scrollTo({ top: target })
  }, progress)
  await page.waitForTimeout(index === 0 ? 1250 : 650)
  await page.screenshot({ path: `qa/screenshots/story-leaf-${index + 1}.png`, fullPage: false })
}

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.addInitScript(() => window.localStorage.setItem('liquidmuppets-handle', '@visualqa'))
await mobile.goto(baseUrl, { waitUntil: 'networkidle' })
await mobile.waitForTimeout(1500)
await mobile.screenshot({ path: 'qa/screenshots/landing-mobile-hero-settled.png', fullPage: false })
await mobile.evaluate(() => {
  document.documentElement.style.scrollBehavior = 'auto'
  const story = document.querySelector('.story-book-section')
  if (!(story instanceof HTMLElement)) return
  const travel = Math.max(1, story.offsetHeight - window.innerHeight * 0.72)
  const storyTop = story.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: storyTop - window.innerHeight * 0.12 + travel * 0.625 })
})
await mobile.waitForTimeout(700)
await mobile.screenshot({ path: 'qa/screenshots/story-mobile-leaf-3.png', fullPage: false })

await browser.close()

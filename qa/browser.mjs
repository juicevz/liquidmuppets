import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
const screenshotDir = new URL('./screenshots/', import.meta.url)
await mkdir(screenshotDir, { recursive: true })

const consoleErrors = []
const results = {}

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`))
}

async function useKnownHandle(context) {
  await context.addInitScript(() => window.localStorage.setItem('liquidmuppets-handle', '@browserqa'))
}

async function revealLanding(page) {
  const items = page.locator('[data-reveal]')
  const count = await items.count()
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index)
    await item.scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (node) => node instanceof HTMLElement && node.classList.contains('is-visible'),
      await item.elementHandle(),
    )
  }
  return { count, hidden: await page.locator('[data-reveal]:not(.is-visible)').count() }
}

const ultraBrowser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })
const ultra = await ultraBrowser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const ultraPage = await ultra.newPage()
watch(ultraPage, '4k')
await ultraPage.goto(baseUrl, { waitUntil: 'networkidle' })
await ultraPage.waitForSelector('.hero-world-art img')
results.hero4kSelected = await ultraPage.locator('.hero-world-art img').evaluate((node) => node.currentSrc.includes('4k'))
await ultra.close()
await ultraBrowser.close()

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })
const desktop = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await useKnownHandle(desktop)
let page = await desktop.newPage()
watch(page, 'desktop')

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-stage')
results.landingTitle = await page.title()
results.heroHeading = (await page.locator('.hero h1').innerText()).replace(/\s+/g, ' ').trim()
results.heroAgentCount = await page.locator('.pixel-agent').count()
results.storyLeaves = await page.locator('.folio-index li').count()
results.strategyCards = await page.locator('.strategy-roles .type-grid article').count()
results.petPreviewCards = await page.locator('.landing-pet-card').count()
results.explicitMainnetBoundary = await page.getByText(/unaudited contracts/i).count() > 0
const soundDock = page.getByRole('button', { name: /Open soundtrack controls/i })
results.soundDockVisible = await soundDock.isVisible()
results.soundDockPosition = await page.locator('.landing-sound-control').evaluate((node) => getComputedStyle(node).position)
await page.waitForFunction(() => {
  const audio = document.querySelector('.landing-sound-control audio')
  return audio instanceof HTMLAudioElement && audio.volume === 0.45
})
results.soundDefault = await page.locator('.landing-sound-control audio').evaluate((audio) => ({
  paused: audio.paused,
  volume: audio.volume,
  loop: audio.loop,
  source: audio.currentSrc || audio.src,
}))
await soundDock.click()
const soundPanel = page.getByRole('group', { name: 'Soundtrack controls' })
results.soundPanelVisible = await soundPanel.isVisible()
results.soundDefaultSlider = await page.getByRole('slider', { name: 'Soundtrack volume' }).inputValue()
results.soundDuration = await soundPanel.getByText(/5:16/).count() === 1
await page.getByRole('button', { name: 'Play soundtrack' }).click()
await page.waitForFunction(() => {
  const audio = document.querySelector('.landing-sound-control audio')
  return audio instanceof HTMLAudioElement && !audio.paused
})
results.soundPlays = await page.locator('.landing-sound-control audio').evaluate((audio) => !audio.paused)
await page.getByRole('slider', { name: 'Soundtrack volume' }).fill('31')
results.soundVolumeChanges = await page.locator('.landing-sound-control audio').evaluate((audio) => Math.abs(audio.volume - 0.31) < 0.001)
results.soundVolumePersists = await page.evaluate(() => window.localStorage.getItem('liquidmuppets-sound-volume') === '31')
await page.getByRole('button', { name: 'Pause soundtrack' }).click()
results.soundPauses = await page.locator('.landing-sound-control audio').evaluate((audio) => audio.paused)
await page.screenshot({ path: new URL('landing-sound-controls.png', screenshotDir).pathname, fullPage: false })
await page.getByRole('button', { name: /Close soundtrack controls/i }).click()
results.soundPanelCloses = await page.locator('.sound-control-panel').count() === 0
const xPickerTrigger = page.getByRole('button', { name: 'Choose an X account' })
await xPickerTrigger.click()
const xAccountMenu = page.getByRole('menu', { name: 'X accounts' })
results.xPickerVisible = await xAccountMenu.isVisible()
results.xAccountHrefs = await xAccountMenu.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
results.xAccountHandles = await xAccountMenu.locator('strong').allTextContents()
results.xAccountDescriptions = await xAccountMenu.locator('small').allTextContents()
results.githubHref = await page.getByRole('link', { name: 'LiquidMuppets on GitHub' }).getAttribute('href')
await page.keyboard.press('Escape')
results.xPickerEscapeCloses = await page.locator('.header-social-menu').count() === 0

const startingTransform = await page.locator('.pixel-agent-blue').evaluate((node) => getComputedStyle(node).transform)
await page.waitForFunction(
  (initial) => {
    const node = document.querySelector('.pixel-agent-blue')
    return node instanceof HTMLElement && getComputedStyle(node).transform !== initial
  },
  startingTransform,
  { timeout: 3_000 },
)
results.normalMotionChanged = true

await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = 'auto'
  const heroScroll = document.querySelector('.hero-scroll')
  if (!(heroScroll instanceof HTMLElement)) return
  const travel = Math.max(1, heroScroll.offsetHeight - window.innerHeight)
  window.scrollTo({ top: travel * 0.64 })
})
await page.waitForFunction(() => {
  const stage = document.querySelector('.pixel-stage')
  return stage instanceof HTMLElement && Number(getComputedStyle(stage).opacity) < 0.8
})
results.heroExitOpacity = Number(await page.locator('.pixel-stage').evaluate((node) => getComputedStyle(node).opacity))

const landingReveal = await revealLanding(page)
results.landingRevealCount = landingReveal.count
results.landingHiddenReveals = landingReveal.hidden
await page.evaluate(() => window.scrollTo({ top: 0 }))
await page.screenshot({ path: new URL('landing-functional.png', screenshotDir).pathname, fullPage: false })

await page.close()
page = await desktop.newPage()
watch(page, 'create')
await page.goto(`${baseUrl}/app/create`, { waitUntil: 'networkidle' })
results.networkPillRemoved = await page.locator('.network-pill').count() === 0
results.createChainNumberRemoved = !((await page.locator('.create-page').innerText()).includes('4663'))
results.petPickerCount = await page.locator('.pet-picker button').count()
results.builderProgressSteps = await page.locator('.compact-builder-progress button').count()
results.descriptionInputs = await page.locator('textarea, input[name="description"]').count()
results.appearanceCopy = await page.getByText(/Appearance changes no permissions/i).count() === 1
await page.getByRole('button', { name: /Continue/ }).click()
await page.getByText('What should this pet do?').waitFor()
results.taskPickerCount = await page.locator('.task-picker button').count()
results.taskMoneyPath = await page.locator('.task-money-path').count() === 1
results.taskDetails = await page.locator('.task-detail-grid > div').count() === 3
await page.getByRole('button', { name: /ETH range/i }).click()
results.ethRangeSelectable = await page.getByRole('button', { name: /ETH range/i }).getAttribute('aria-pressed') === 'true'
results.ethRangeExplained = await page.getByText(/Converts WETH through the canonical/i).count() === 1
await page.getByRole('button', { name: /Launch pool/i }).click()
results.launchPoolSelectable = await page.getByRole('button', { name: /Launch pool/i }).getAttribute('aria-pressed') === 'true'
results.launchPoolExplained = await page.getByText(/Keeps a small, isolated WETH reserve/i).count() === 1
await page.getByRole('button', { name: /ETH range/i }).click()
await page.getByRole('button', { name: /Continue/ }).click()
await page.getByText('Choose where this pet can work.').waitFor()
results.marketUniverseOptions = await page.locator('.strategy-market-grid button').count()
results.marketReviewOptions = await page.locator('.strategy-market-grid .market-review').count()
results.liveMarketDefault = await page.getByRole('button', { name: /ETH market/i }).getAttribute('aria-pressed') === 'true'
results.marketPairs = await page.locator('.strategy-market-pair').allTextContents()
await page.getByRole('button', { name: /NVIDIA market/i }).click()
results.marketReviewExplained = await page.getByText(/current factory cannot deploy this market yet/i).count() === 1
results.stockTokenBoundary = await page.getByText(/not shares in the underlying company/i).count() === 1
results.reviewRouteBlocksContinue = await page.getByRole('button', { name: /Continue/ }).isDisabled()
await page.getByRole('button', { name: /ETH market/i }).click()
results.liveMarketReady = await page.getByText(/ready in current factory/i).count() === 1
results.liveRouteAllowsContinue = !(await page.getByRole('button', { name: /Continue/ }).isDisabled())
await page.screenshot({ path: new URL('create-market-universe.png', screenshotDir).pathname, fullPage: false })
await page.getByRole('button', { name: /Continue/ }).click()
await page.getByText('Name it and open the floor.').waitFor()
results.floorField = await page.locator('label').filter({ hasText: 'base floor' }).locator('input').count() === 1
results.keySupplyField = await page.locator('label').filter({ hasText: 'Key supply' }).locator('input').count() === 1
results.firstAskCopy = await page.getByText(/This becomes a real ask/i).count() === 1
await page.screenshot({ path: new URL('create-seven-pets.png', screenshotDir).pathname, fullPage: false })
await page.locator('label').filter({ hasText: 'muppet name' }).locator('input').fill('browser gate')
await page.locator('label').filter({ hasText: 'Key ticker' }).locator('input').fill('GATE')
await page.getByRole('button', { name: /Continue/ }).click()
results.launchTokenGate = await page.getByText('100,000 $MUPPETS required to launch.', { exact: true }).count() === 1
results.launchGateConnect = await page.getByRole('button', { name: 'Connect wallet' }).count() === 1

await page.close()
page = await desktop.newPage()
watch(page, 'market')
await page.goto(`${baseUrl}/app`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !document.body.textContent?.includes('Reading chain'))
results.marketHeading = await page.locator('.marketplace-page h1').innerText()
results.marketChainNumberRemoved = !((await page.locator('.marketplace-page').innerText()).includes('4663'))
results.listedPercent = await page.locator('.key-market-summary').getByText(/pets listed/i).count() === 1
results.marketRows = await page.locator('.key-market-row').count()
results.marketCards = await page.locator('.live-agent-card').count()
results.marketEmpty = await page.locator('.market-empty, .deployment-pending').count()
await page.locator('.public-activity-item').first().waitFor({ timeout: 10_000 })
results.activityRows = await page.locator('.public-activity-item').count()
results.activityHasDevHandle = await page.locator('.public-activity-item').getByText('@liquidmuppets_dev').count() > 0
results.activityValuesStyled = await page.locator('.public-activity-item.activity-positive, .public-activity-item.activity-negative').count() > 0
if (results.marketRows > 0) {
  results.keyMarketColumns = await page.locator('.key-market-board-head > span').count()
  await page.locator('.key-market-row').first().click()
  await page.getByRole('dialog').waitFor()
  results.drawerVaultPanel = await page.getByRole('dialog').getByText(/ERC-4626 share/i).count() === 1
  results.drawerTaskPath = await page.getByRole('dialog').getByText(/creator signs, policy enforces/i).count() === 1
  results.drawerKeyTabs = await page.getByRole('dialog').locator('.key-tabs button').count()
  results.drawerHonestYield = await page.getByRole('dialog').getByText(/APY is variable/i).count() === 1
  results.drawerOverflow = await page.getByRole('dialog').evaluate((node) => node.scrollWidth > node.clientWidth)
  await page.screenshot({ path: new URL('marketplace-live-drawer.png', screenshotDir).pathname, fullPage: false })
  await page.getByRole('button', { name: 'Close agent details' }).click()
}

await page.close()
page = await desktop.newPage()
watch(page, 'portfolio')
await page.goto(`${baseUrl}/app/portfolio`, { waitUntil: 'networkidle' })
results.portfolioHonestCopy = await page.getByText(/No estimated PnL/i).count() === 1
results.portfolioConnectState = await page.getByRole('heading', { name: 'Connect your wallet.' }).count() === 1
results.portfolioChainNumberRemoved = !((await page.locator('.portfolio-page').innerText()).includes('4663'))

await page.close()
page = await desktop.newPage()
watch(page, 'docs')
await page.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle' })
results.docsTitle = await page.title()
results.docsSections = await page.locator('.docs-layout article > section').count()
results.docsTokenGate = await page.getByRole('heading', { name: '$MUPPETS launch access' }).count() === 1
results.docsSevenPets = await page.getByRole('heading', { name: 'Seven pets, three live tasks' }).count() === 1
results.docsMarketUniverse = await page.getByRole('heading', { name: 'Stock Token and community markets' }).count() === 1
results.docsAlgorithm = await page.getByRole('heading', { name: 'The backend algorithm' }).count() === 1
results.docsBoundary = await page.getByText(/real USDG, WETH, Morpho, Uniswap and EZManager/i).count() === 1
results.docsLiveContracts = await page.getByText(/0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460/i).count() === 1
results.docsVisuals = await page.locator('.docs-visual').count()
results.docsPetCards = await page.locator('.docs-pet-card').count()
results.docsPetNames = await page.locator('.docs-pet-card strong').allTextContents()
results.docsPetNamesUnclipped = await page.locator('.docs-pet-card strong').evaluateAll((names) => names.every((name) => name.scrollWidth <= name.clientWidth))
results.docsMoneyPath = await page.locator('.docs-task-route').count() === 3
const docsImages = page.locator('.docs-visual img')
for (let index = 0; index < await docsImages.count(); index += 1) {
  const docsImage = docsImages.nth(index)
  await docsImage.scrollIntoViewIfNeeded()
  await docsImage.evaluate((image) => image instanceof HTMLImageElement && image.decode().catch(() => undefined))
}
results.docsImagesReady = await page.locator('.docs-visual img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))
await page.screenshot({ path: new URL('docs-functional.png', screenshotDir).pathname, fullPage: false })
await page.locator('#docs-03').scrollIntoViewIfNeeded()
await page.screenshot({ path: new URL('docs-seven-pets.png', screenshotDir).pathname, fullPage: false })
await page.locator('#docs-04').scrollIntoViewIfNeeded()
await page.screenshot({ path: new URL('docs-money-path.png', screenshotDir).pathname, fullPage: false })
await desktop.close()

const degraded = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await useKnownHandle(degraded)
await degraded.route('**/api/v1/rpc', (route) => route.fulfill({
  status: 502,
  contentType: 'application/json',
  body: JSON.stringify({ detail: 'simulated upstream outage' }),
}))
const degradedPage = await degraded.newPage()
await degradedPage.goto(`${baseUrl}/app/create`, { waitUntil: 'networkidle' })
await degradedPage.getByRole('button', { name: /Continue/ }).click()
await degradedPage.getByText('What should this pet do?').waitFor()
results.degradedTaskPickerCount = await degradedPage.locator('.task-picker button').count()
results.degradedTaskWarning = await degradedPage.getByRole('alert')
  .getByText(/task selection and wallet transactions still work/i).count() === 1
await degraded.close()

const reduced = await browser.newContext({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' })
const reducedPage = await reduced.newPage()
watch(reducedPage, 'reduced')
await reducedPage.goto(baseUrl, { waitUntil: 'networkidle' })
const reducedStart = await reducedPage.locator('.pixel-agent-blue').evaluate((node) => getComputedStyle(node).transform)
await reducedPage.waitForFunction(
  (initial) => {
    const node = document.querySelector('.pixel-agent-blue')
    return node instanceof HTMLElement && getComputedStyle(node).transform !== initial
  },
  reducedStart,
  { timeout: 3_000 },
)
results.reducedMotionAlive = true
await reduced.close()
await browser.close()

const mobileBrowser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })
const mobile = await mobileBrowser.newContext({ viewport: { width: 390, height: 844 } })
await useKnownHandle(mobile)
const mobilePage = await mobile.newPage()
watch(mobilePage, 'mobile')
await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' })
results.mobileLandingOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobilePage.getByRole('button', { name: /Open soundtrack controls/i }).click()
results.mobileSoundPanelVisible = await mobilePage.getByRole('group', { name: 'Soundtrack controls' }).isVisible()
results.mobileSoundPanelInViewport = await mobilePage.getByRole('group', { name: 'Soundtrack controls' }).evaluate((node) => {
  const rect = node.getBoundingClientRect()
  return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight
})
results.mobileSoundOpenOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobilePage.getByRole('button', { name: /Close soundtrack controls/i }).click()
await mobilePage.getByRole('button', { name: 'Choose an X account' }).click()
results.mobileXPickerVisible = await mobilePage.getByRole('menu', { name: 'X accounts' }).isVisible()
results.mobileXPickerInViewport = await mobilePage.getByRole('menu', { name: 'X accounts' }).evaluate((node) => {
  const rect = node.getBoundingClientRect()
  return rect.left >= 0 && rect.right <= window.innerWidth
})
await mobilePage.goto(`${baseUrl}/app/create`, { waitUntil: 'networkidle' })
results.mobileNavVisible = await mobilePage.locator('.mobile-app-nav').isVisible()
results.mobileCreateOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobilePage.screenshot({ path: new URL('create-mobile.png', screenshotDir).pathname, fullPage: false })
await mobilePage.getByRole('button', { name: /Continue/ }).click()
await mobilePage.getByRole('button', { name: /ETH range/i }).click()
await mobilePage.getByRole('button', { name: /Continue/ }).click()
await mobilePage.getByText('Choose where this pet can work.').waitFor()
results.mobileMarketOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobileMarketColumns = await mobilePage.locator('.strategy-market-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
await mobilePage.screenshot({ path: new URL('market-mobile.png', screenshotDir).pathname, fullPage: false })
await mobilePage.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle' })
results.mobileDocsOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobile.close()
await mobileBrowser.close()

results.consoleErrors = consoleErrors
console.log(JSON.stringify(results, null, 2))

const marketStateValid = results.marketRows > 0
  ? results.marketRows === results.marketCards
    && results.keyMarketColumns === 7
    && results.activityRows > 0
    && results.activityHasDevHandle
    && results.activityValuesStyled
    && results.drawerVaultPanel
    && results.drawerTaskPath
    && results.drawerKeyTabs === 5
    && results.drawerHonestYield
    && !results.drawerOverflow
  : results.marketEmpty > 0

const failed =
  results.landingTitle !== 'LIQUIDMUPPETS | onchain liquidity agents'
  || results.heroHeading !== 'Muppets work. You set the limits.'
  || results.heroAgentCount !== 3
  || results.storyLeaves !== 4
  || results.strategyCards !== 3
  || results.petPreviewCards !== 7
  || !results.explicitMainnetBoundary
  || !results.soundDockVisible
  || results.soundDockPosition !== 'fixed'
  || !results.soundDefault.paused
  || results.soundDefault.volume !== 0.45
  || !results.soundDefault.loop
  || !results.soundDefault.source.includes('granat-extended')
  || !results.soundPanelVisible
  || results.soundDefaultSlider !== '45'
  || !results.soundDuration
  || !results.soundPlays
  || !results.soundVolumeChanges
  || !results.soundVolumePersists
  || !results.soundPauses
  || !results.soundPanelCloses
  || !results.xPickerVisible
  || results.xAccountHrefs.join(',') !== 'https://x.com/liquidmuppets,https://x.com/AMBF'
  || JSON.stringify(results.xAccountHandles) !== JSON.stringify(['@liquidmuppets', '@AMBF'])
  || JSON.stringify(results.xAccountDescriptions) !== JSON.stringify(['official', 'juice, founder'])
  || results.githubHref !== 'https://github.com/juicevz/liquidmuppets'
  || !results.xPickerEscapeCloses
  || !results.normalMotionChanged
  || results.heroExitOpacity >= 0.8
  || results.landingHiddenReveals !== 0
  || !results.networkPillRemoved
  || !results.createChainNumberRemoved
  || results.petPickerCount !== 7
  || results.builderProgressSteps !== 5
  || results.descriptionInputs !== 0
  || !results.appearanceCopy
  || results.taskPickerCount !== 3
  || !results.taskMoneyPath
  || !results.taskDetails
  || !results.ethRangeSelectable
  || !results.ethRangeExplained
  || !results.launchPoolSelectable
  || !results.launchPoolExplained
  || results.marketUniverseOptions !== 5
  || results.marketReviewOptions !== 4
  || !results.liveMarketDefault
  || JSON.stringify(results.marketPairs) !== JSON.stringify(['WETH / USDG', 'NVDA / USDG', 'GME / USDG', 'SPCX / USDG', 'SPY / USDG'])
  || !results.marketReviewExplained
  || !results.stockTokenBoundary
  || !results.reviewRouteBlocksContinue
  || !results.liveMarketReady
  || !results.liveRouteAllowsContinue
  || !results.floorField
  || !results.keySupplyField
  || !results.firstAskCopy
  || !results.launchTokenGate
  || !results.launchGateConnect
  || results.marketHeading !== 'Pet marketplace.'
  || !results.marketChainNumberRemoved
  || !results.listedPercent
  || !marketStateValid
  || !results.portfolioHonestCopy
  || !results.portfolioConnectState
  || !results.portfolioChainNumberRemoved
  || results.docsTitle !== 'Docs | LIQUIDMUPPETS'
  || results.docsSections !== 13
  || !results.docsTokenGate
  || !results.docsSevenPets
  || !results.docsMarketUniverse
  || !results.docsAlgorithm
  || !results.docsBoundary
  || !results.docsLiveContracts
  || results.docsVisuals !== 7
  || results.docsPetCards !== 7
  || results.docsPetNames.join(',') !== 'blue,sage,stone,fox,plum,frog,gold'
  || !results.docsPetNamesUnclipped
  || !results.docsMoneyPath
  || !results.docsImagesReady
  || !results.reducedMotionAlive
  || !results.hero4kSelected
  || results.mobileLandingOverflow
  || !results.mobileSoundPanelVisible
  || !results.mobileSoundPanelInViewport
  || results.mobileSoundOpenOverflow
  || !results.mobileXPickerVisible
  || !results.mobileXPickerInViewport
  || results.mobileCreateOverflow
  || results.mobileMarketOverflow
  || results.mobileMarketColumns !== 1
  || results.mobileDocsOverflow
  || !results.mobileNavVisible
  || results.degradedTaskPickerCount !== 3
  || !results.degradedTaskWarning
  || consoleErrors.length > 0

if (failed) process.exitCode = 1

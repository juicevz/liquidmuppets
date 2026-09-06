import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
const expectedMuppetsToken = '0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189'
const screenshotDir = new URL('./screenshots/', import.meta.url)
await mkdir(screenshotDir, { recursive: true })

const consoleErrors = []
const results = {}

function watch(page, label) {
  page.setDefaultNavigationTimeout(90_000)
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`))
}

async function useKnownHandle(context) {
  await context.addInitScript(() => window.localStorage.setItem('liquidmuppets-handle', '@browserqa'))
}

async function loadLaunchCommandFixture() {
  const [configResponse, performanceResponse] = await Promise.all([
    fetch(`${baseUrl}/api/v1/contracts`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/v1/agents/0/performance`, { cache: 'no-store' }),
  ])
  if (!configResponse.ok || !performanceResponse.ok) throw new Error('Could not load the live command-center fixture.')
  const config = await configResponse.json()
  const performance = await performanceResponse.json()
  const wallet = performance.agent.creator
  const sessionKey = `liquidmuppets-launch:${config.chainId}:${config.factory.toLowerCase()}:${wallet.toLowerCase()}`
  return {
    wallet,
    sessionKey,
    session: JSON.stringify({
      version: 1,
      chainId: config.chainId,
      factory: config.factory,
      wallet,
      input: {
        petId: performance.agent.pet_id,
        taskId: performance.agent.task_id,
        name: performance.agent.name,
        keySymbol: performance.key_market.symbol ?? 'MFROG',
        keySupply: Number(performance.key_market.supply_raw ?? 100),
        listingQuantity: 20,
        floorPriceEth: '0.001',
      },
      checkpoint: {
        createTx: '0x50e08ead849fc119d1b7bb8eb7dc2bdb3bebee3930b5d6478a044bc1b496e367',
        createConfirmed: true,
        agentId: String(performance.agent.id),
        vault: performance.agent.vault,
        key: performance.agent.key,
        approveTx: '0x6c39204fda0ec2f7d84e6a058568c00e3d649bb9437eaf30cba84b66095b0171',
        approveConfirmed: true,
        listingTx: '0xd340e3bf3f843470a712e9397edf5dc367b7e148a4f9f1f3f12e58d0fd73145b',
        listingConfirmed: true,
      },
      updatedAt: new Date().toISOString(),
    }),
  }
}

async function useLaunchCommandFixture(context, fixture) {
  await context.addInitScript(({ wallet, sessionKey, session }) => {
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: async ({ method }) => {
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet]
          if (method === 'wallet_switchEthereumChain') return null
          throw new Error(`Browser QA wallet does not implement ${method}`)
        },
      },
    })
    window.localStorage.setItem('liquidmuppets-handle', '@browserqa')
    window.localStorage.setItem(sessionKey, session)
  }, fixture)
}

async function warmPublicActivity() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/activity?limit=40`, { cache: 'no-store' }).catch(() => null)
    if (response?.ok) return
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  throw new Error('Could not warm the public activity cache for browser QA.')
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
const launchCommandFixture = await loadLaunchCommandFixture()
const desktop = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await useKnownHandle(desktop)
let page = await desktop.newPage()
watch(page, 'desktop')

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-stage')
const accessGateProof = await page.evaluate(async ({ tokenAddress }) => {
  try {
    const [configResponse, accessResponse] = await Promise.all([
      fetch('/api/v1/contracts', { cache: 'no-store' }),
      fetch('/api/v1/access/0x0000000000000000000000000000000000000000', { cache: 'no-store' }),
    ])
    const config = await configResponse.json()
    const access = await accessResponse.json()
    return {
      configured: configResponse.ok && config.accessGate?.configured === true,
      addressMatches: String(config.accessGate?.tokenAddress).toLowerCase() === tokenAddress.toLowerCase(),
      minimumMatches: config.accessGate?.minimum === '15000',
      liveRead: accessResponse.ok
        && access.configured === true
        && access.decimals === 18
        && access.minimumRaw === '15000000000000000000000'
        && access.reason === 'below_minimum',
    }
  } catch {
    return { configured: false, addressMatches: false, minimumMatches: false, liveRead: false }
  }
}, { tokenAddress: expectedMuppetsToken })
results.muppetsGateConfigured = accessGateProof.configured
results.muppetsAddressMatches = accessGateProof.addressMatches
results.muppetsMinimumMatches = accessGateProof.minimumMatches
results.muppetsLiveRead = accessGateProof.liveRead
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
results.launchPoolExplained = await page.getByText(/Keeps a small WETH position/i).count() === 1
await page.getByRole('button', { name: /ETH range/i }).click()
await page.getByRole('button', { name: /Continue/ }).click()
await page.getByText('Choose where this pet can work.').waitFor()
results.marketUniverseOptions = await page.locator('.strategy-market-grid button').count()
results.marketReviewOptions = await page.locator('.strategy-market-grid .market-review').count()
results.liveMarketDefault = await page.getByRole('button', { name: /ETH market/i }).getAttribute('aria-pressed') === 'true'
results.marketPairs = await page.locator('.strategy-market-pair').allTextContents()
results.marketChecks = await page.locator('.strategy-market-detail li').count()
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
results.launchTokenGate = await page.getByText('15,000 $MUPPETS required to launch.', { exact: true }).count() === 1
results.launchGateConnect = await page.getByRole('button', { name: 'Connect wallet' }).count() === 1
const muppetsContractLink = page.getByRole('link', { name: `MUPPETS contract ${expectedMuppetsToken}` })
results.launchTokenAddressLink = await muppetsContractLink.count() === 1
  && (await muppetsContractLink.getAttribute('href')) === `https://robinhoodchain.blockscout.com/address/${expectedMuppetsToken}`

await page.close()
const commandCenter = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await useLaunchCommandFixture(commandCenter, launchCommandFixture)
const commandPage = await commandCenter.newPage()
watch(commandPage, 'command-center')
await commandPage.goto(`${baseUrl}/app/create`, { waitUntil: 'domcontentloaded' })
await commandPage.getByRole('heading', { name: 'Muppet live. Put it to work.' }).waitFor({ timeout: 60_000 })
results.commandCenterHeading = await commandPage.getByRole('heading', { name: 'Muppet live. Put it to work.' }).count() === 1
results.commandReceiptStages = await commandPage.locator('.launch-stage').count()
results.commandConfirmedStages = await commandPage.locator('.launch-stage.confirmed').count()
await commandPage.locator('.command-fund-preview strong').first().waitFor({ timeout: 60_000 })
await commandPage.waitForFunction(() => {
  const value = document.querySelector('.command-fund-preview strong')?.textContent
  return typeof value === 'string' && value.length > 0 && value !== 'reading onchain'
}, undefined, { timeout: 30_000 })
results.commandFundAction = await commandPage.getByRole('button', { name: /Fund vault now/i }).count() === 1
results.commandSharePreview = !((await commandPage.locator('.command-fund-preview strong').first().innerText()).includes('unavailable'))
results.commandKeeperTiming = await commandPage.getByText('next automatic check', { exact: true }).count() === 1
results.commandPerformanceHref = await commandPage.getByRole('link', { name: /Open performance/i }).getAttribute('href')
results.commandShareHref = await commandPage.getByRole('link', { name: /Share on X/i }).getAttribute('href')
results.commandRecoveryDisclosure = await commandPage.getByText(/public transaction metadata only/i).count() === 1
results.commandCenterOverflow = await commandPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await commandPage.screenshot({ path: new URL('post-launch-command-center.png', screenshotDir).pathname, fullPage: true })
await commandCenter.close()

const partialSession = JSON.parse(launchCommandFixture.session)
partialSession.checkpoint = {
  createTx: partialSession.checkpoint.createTx,
  createConfirmed: false,
}
const recovery = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await useLaunchCommandFixture(recovery, { ...launchCommandFixture, session: JSON.stringify(partialSession) })
const recoveryPage = await recovery.newPage()
watch(recoveryPage, 'launch-recovery')
await recoveryPage.goto(`${baseUrl}/app/create`, { waitUntil: 'domcontentloaded' })
await recoveryPage.getByRole('button', { name: /Resume launch/i }).waitFor({ timeout: 60_000 })
results.launchRecoveryAction = await recoveryPage.getByRole('button', { name: /Resume launch/i }).count() === 1
results.launchRecoverySubmitted = await recoveryPage.locator('.launch-stage.submitted').count()
results.launchRecoveryWaiting = await recoveryPage.locator('.launch-stage.waiting').count()
results.launchRecoveryCopy = await recoveryPage.getByText(/continues at the first unfinished confirmation/i).count() === 1
await recoveryPage.screenshot({ path: new URL('launch-recovery.png', screenshotDir).pathname, fullPage: false })
await recovery.close()

await warmPublicActivity()
page = await desktop.newPage()
watch(page, 'market')
await page.goto(`${baseUrl}/app`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !document.body.textContent?.includes('Reading chain'))
await page.locator('.performance-market-row').first().waitFor({ timeout: 60_000 })
results.marketHeading = await page.locator('.marketplace-page h1').innerText()
results.marketChainNumberRemoved = !((await page.locator('.marketplace-page').innerText()).includes('4663'))
results.listedPercent = await page.locator('.key-market-summary').getByText(/pets listed/i).count() === 1
results.marketRows = await page.locator('.key-market-row').count()
results.marketCards = await page.locator('.live-agent-card').count()
results.performanceMarketRows = await page.locator('.performance-market-row').count()
results.performanceMarketColumns = await page.locator('.performance-market-table-head > span').count()
results.performanceMarketHealth = await page.locator('.performance-market-row .market-performance-health').count()
results.performanceMarketOracle = await page.locator('.performance-market-row').first().getByText(/timestamp not exposed|old|not used|unavailable/i).count() > 0
results.performanceMarketKeeper = await page.locator('.performance-market-row .keeper-value').count()
results.performanceMarketEndpoint = await page.evaluate(async () => {
  const response = await fetch('/api/v1/marketplace/performance', { cache: 'no-store' })
  const body = await response.json()
  return response.ok && Array.isArray(body.items) && body.items.length > 0
})
results.marketEmpty = await page.locator('.market-empty, .deployment-pending').count()
results.rwaReserveModule = await page.locator('.rwa-reserve-module').count() === 1
await page.locator('.rwa-reserve-module summary').click()
await page.locator('.rwa-route-strip span').first().waitFor({ timeout: 20_000 })
results.rwaRouteCount = await page.locator('.rwa-route-strip span').count()
results.rwaAaplHolding = await page.locator('.rwa-holdings a').filter({ hasText: 'AAPL' }).count() === 1
results.rwaReserveContract = (await page.getByRole('link', { name: /Open reserve contract/i }).getAttribute('href'))?.includes('0xF10DA007314bB3e7B34FE06bB5c590190dcE9765')
results.rwaBootstrapDisclosure = await page.getByText(/dev-funded bootstrap liquidity/i).count() === 1
await page.locator('.public-activity-item').first().waitFor({ timeout: 10_000 })
results.activityRows = await page.locator('.public-activity-item').count()
results.activityHasDevHandle = await page.locator('.public-activity-item').getByText('@liquidmuppets_dev').count() > 0
results.activityValuesStyled = await page.locator('.public-activity-item.activity-positive, .public-activity-item.activity-negative').count() > 0
if (results.performanceMarketRows >= 2) {
  await page.locator('.performance-market-row').nth(0).getByRole('button', { name: /^Compare / }).click()
  await page.locator('.performance-market-row').nth(1).getByRole('button', { name: /^Compare / }).click()
  await page.getByRole('heading', { name: 'Compare Muppets' }).waitFor()
  results.comparisonSelected = await page.locator('.performance-market-row.comparison-selected').count()
  results.comparisonCards = await page.locator('.comparison-card').count()
  results.comparisonAssetsExplicit = await page.locator('.comparison-boundaries').getByText(/assets:/i).count() === 1
  results.comparisonWindowsExplicit = await page.locator('.comparison-card').getByText('tracking began', { exact: true }).count() === 2
  results.comparisonFlowAdjusted = await page.locator('.comparison-card').getByText('flow-adjusted change', { exact: true }).count() === 2
  results.comparisonKeeperReasons = await page.locator('.comparison-card').getByText('last keeper decision', { exact: true }).count() === 2
  results.comparisonPerformanceLinks = await page.locator('.comparison-card').getByRole('link', { name: /full record/i }).count()
  results.comparisonNoRanking = await page.getByText(/No cross-asset ranking is calculated/i).count() === 1
  results.comparisonOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  await page.screenshot({ path: new URL('performance-marketplace-comparison.png', screenshotDir).pathname, fullPage: false })
  await page.getByRole('button', { name: 'Clear' }).click()
}
if (results.marketRows > 0) {
  results.keyMarketColumns = await page.locator('.key-market-board-head > span').count()
  await page.locator('.key-market-row').first().click()
  await page.getByRole('dialog').waitFor()
  results.drawerVaultPanel = await page.getByRole('dialog').getByText(/ERC-4626 share/i).count() === 1
  results.drawerTaskPath = await page.getByRole('dialog').locator('.execution-path').count() === 1
  results.drawerTinyStatusRemoved = await page.getByRole('dialog').getByText(/creator signs, policy enforces/i).count() === 0
  results.drawerKeyTabs = await page.getByRole('dialog').locator('.key-tabs button').count()
  results.drawerPerformanceLink = (await page.getByRole('dialog').getByRole('link', { name: /public performance/i }).getAttribute('href')) === '/app/muppet/0'
  results.drawerRiskNoteRemoved = await page.getByRole('dialog').getByText(/APY is variable|concentrated liquidity|reviewed launch route/i).count() === 0
  results.drawerKeyQualifierRemoved = await page.getByRole('dialog').locator('.fee-note, .honest-test-note, .execution-state-note').count() === 0
  results.drawerOverflow = await page.getByRole('dialog').evaluate((node) => node.scrollWidth > node.clientWidth)
  await page.screenshot({ path: new URL('marketplace-live-drawer.png', screenshotDir).pathname, fullPage: false })
  await page.getByRole('button', { name: 'Close agent details' }).click()
}

await page.close()
page = await desktop.newPage()
watch(page, 'performance')
await page.goto(`${baseUrl}/app/muppet/1`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: 'range fox' }).waitFor({ timeout: 60_000 })
results.performanceSinceTracking = await page.getByRole('heading', { name: 'Since tracking began' }).count() === 1
results.performanceChartPoints = await page.locator('.performance-chart circle').count()
results.performanceFlowAdjusted = await page.getByText('flow-adjusted change', { exact: true }).count() === 1
results.performanceCapital = await page.getByRole('heading', { name: 'Deployed versus idle' }).count() === 1
results.performanceExactRange = await page.getByText(/tick -\d+ to -\d+/).count() === 1
results.performanceOracleBoundary = await page.getByText(/timestamp not exposed/i).count() > 0
results.performanceKeeper = await page.getByRole('heading', { name: 'Last keeper decision' }).count() === 1
results.performanceReceipts = await page.locator('.receipt-row').count()
results.performanceKeySeparate = await page.getByRole('heading', { name: 'Agent Key market' }).count() === 1
results.performanceNoHistoricalApy = await page.getByText(/historical APY/i).count() === 0
results.performanceOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: new URL('muppet-performance.png', screenshotDir).pathname, fullPage: false })

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
results.docsFeeReserve = await page.getByRole('heading', { name: 'Marketplace fee reserve' }).count() === 1
results.docsPerformance = await page.getByRole('heading', { name: 'Public Muppet performance' }).count() === 1
results.docsPerformanceMarketplace = await page.getByText(/select any two Muppets to compare/i).count() === 1
results.docsCreatorProfiles = await page.getByText(/Every creator wallet has a shareable/i).count() === 1
results.docsSystemPulse = await page.getByText(/combines decoded transaction events and recorded keeper decisions/i).count() === 1
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
await mobilePage.goto(`${baseUrl}/app/muppet/1`, { waitUntil: 'domcontentloaded' })
await mobilePage.getByRole('heading', { name: 'range fox' }).waitFor({ timeout: 60_000 })
results.mobilePerformanceOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobilePerformanceKeyVisible = await mobilePage.getByRole('heading', { name: 'Agent Key market' }).count() === 1
await mobile.close()

const mobileCommand = await mobileBrowser.newContext({ viewport: { width: 320, height: 720 } })
await useLaunchCommandFixture(mobileCommand, launchCommandFixture)
const mobileCommandPage = await mobileCommand.newPage()
watch(mobileCommandPage, 'command-center-320px')
await mobileCommandPage.goto(`${baseUrl}/app/create`, { waitUntil: 'domcontentloaded' })
await mobileCommandPage.getByRole('heading', { name: 'Muppet live. Put it to work.' }).waitFor({ timeout: 60_000 })
await mobileCommandPage.locator('.command-fund-preview').waitFor({ timeout: 60_000 })
results.mobileCommandCenterOverflow = await mobileCommandPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobileCommandColumns = await mobileCommandPage.locator('.command-center-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
await mobileCommandPage.screenshot({ path: new URL('post-launch-command-center-320.png', screenshotDir).pathname, fullPage: true })
await mobileCommand.close()
await mobileBrowser.close()

const narrowBrowser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })
const narrow = await narrowBrowser.newContext({ viewport: { width: 320, height: 720 } })
const narrowPage = await narrow.newPage()
watch(narrowPage, '320px')
await narrowPage.goto(`${baseUrl}/app`, { waitUntil: 'networkidle' })
await narrowPage.locator('.performance-market-row').first().waitFor({ timeout: 60_000 })
results.narrowCompareButtonVisible = await narrowPage.locator('.performance-market-row').first().getByRole('button', { name: /^Compare / }).isVisible()
await narrowPage.locator('.performance-market-row').nth(0).getByRole('button', { name: /^Compare / }).click()
await narrowPage.locator('.performance-market-row').nth(1).getByRole('button', { name: /^Compare / }).click()
await narrowPage.getByRole('heading', { name: 'Compare Muppets' }).waitFor()
results.narrowComparisonColumns = await narrowPage.locator('.comparison-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
results.narrowAppOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.narrowHeaderVisible = await narrowPage.locator('.mobile-app-nav').isVisible()
await narrowPage.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle' })
results.narrowDocsOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await narrowPage.goto(`${baseUrl}/app/muppet/1`, { waitUntil: 'domcontentloaded' })
await narrowPage.getByRole('heading', { name: 'range fox' }).waitFor({ timeout: 60_000 })
results.narrowPerformanceOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await narrow.close()
await narrowBrowser.close()

results.consoleErrors = consoleErrors
console.log(JSON.stringify(results, null, 2))

const marketStateValid = results.marketRows > 0
  ? results.marketRows === results.marketCards
    && results.performanceMarketRows === results.marketCards
    && results.performanceMarketColumns === 8
    && results.performanceMarketHealth === results.marketCards
    && results.performanceMarketOracle
    && results.performanceMarketKeeper === results.marketCards
    && results.performanceMarketEndpoint
    && results.comparisonSelected === 2
    && results.comparisonCards === 2
    && results.comparisonAssetsExplicit
    && results.comparisonWindowsExplicit
    && results.comparisonFlowAdjusted
    && results.comparisonKeeperReasons
    && results.comparisonPerformanceLinks === 2
    && results.comparisonNoRanking
    && !results.comparisonOverflow
    && results.keyMarketColumns === 7
    && results.activityRows > 0
    && results.activityHasDevHandle
    && results.activityValuesStyled
    && results.rwaReserveModule
    && results.rwaRouteCount === 26
    && results.rwaAaplHolding
    && results.rwaReserveContract
    && results.rwaBootstrapDisclosure
    && results.drawerVaultPanel
    && results.drawerTaskPath
    && results.drawerTinyStatusRemoved
    && results.drawerKeyTabs === 5
    && results.drawerPerformanceLink
    && results.drawerRiskNoteRemoved
    && results.drawerKeyQualifierRemoved
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
  || !results.muppetsGateConfigured
  || !results.muppetsAddressMatches
  || !results.muppetsMinimumMatches
  || !results.muppetsLiveRead
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
  || results.marketUniverseOptions !== 1
  || results.marketReviewOptions !== 0
  || !results.liveMarketDefault
  || JSON.stringify(results.marketPairs) !== JSON.stringify(['WETH / USDG'])
  || results.marketChecks !== 3
  || !results.liveRouteAllowsContinue
  || !results.floorField
  || !results.keySupplyField
  || !results.firstAskCopy
  || !results.launchTokenGate
  || !results.launchGateConnect
  || !results.launchTokenAddressLink
  || !results.commandCenterHeading
  || results.commandReceiptStages !== 3
  || results.commandConfirmedStages !== 3
  || !results.commandFundAction
  || !results.commandSharePreview
  || !results.commandKeeperTiming
  || results.commandPerformanceHref !== '/app/muppet/0'
  || !results.commandShareHref?.startsWith('https://x.com/intent/post?')
  || !results.commandRecoveryDisclosure
  || results.commandCenterOverflow
  || !results.launchRecoveryAction
  || results.launchRecoverySubmitted !== 1
  || results.launchRecoveryWaiting !== 2
  || !results.launchRecoveryCopy
  || results.marketHeading !== 'Pet marketplace.'
  || !results.marketChainNumberRemoved
  || !results.listedPercent
  || !marketStateValid
  || !results.performanceSinceTracking
  || results.performanceChartPoints < 1
  || !results.performanceFlowAdjusted
  || !results.performanceCapital
  || !results.performanceExactRange
  || !results.performanceOracleBoundary
  || !results.performanceKeeper
  || results.performanceReceipts < 1
  || !results.performanceKeySeparate
  || !results.performanceNoHistoricalApy
  || results.performanceOverflow
  || !results.portfolioHonestCopy
  || !results.portfolioConnectState
  || !results.portfolioChainNumberRemoved
  || results.docsTitle !== 'Docs | LIQUIDMUPPETS'
  || results.docsSections !== 16
  || !results.docsTokenGate
  || !results.docsSevenPets
  || !results.docsFeeReserve
  || !results.docsPerformance
  || !results.docsPerformanceMarketplace
  || !results.docsCreatorProfiles
  || !results.docsSystemPulse
  || !results.docsAlgorithm
  || !results.docsBoundary
  || !results.docsLiveContracts
  || results.docsVisuals !== 8
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
  || results.mobilePerformanceOverflow
  || !results.mobilePerformanceKeyVisible
  || !results.mobileNavVisible
  || results.mobileCommandCenterOverflow
  || results.mobileCommandColumns !== 1
  || results.narrowAppOverflow
  || !results.narrowCompareButtonVisible
  || results.narrowComparisonColumns !== 1
  || results.narrowDocsOverflow
  || results.narrowPerformanceOverflow
  || !results.narrowHeaderVisible
  || results.degradedTaskPickerCount !== 3
  || !results.degradedTaskWarning
  || consoleErrors.length > 0

if (failed) process.exitCode = 1

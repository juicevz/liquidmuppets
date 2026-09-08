import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
const expectedMuppetsToken = '0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189'
const expectedDevWallet = '0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f'
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
await ultraPage.waitForSelector('.simple-home-art img')
results.hero4kSelected = await ultraPage.locator('.simple-home-art img').evaluate((node) => node.currentSrc.includes('4k'))
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
        && access.walletBalance === '0'
        && access.bondedBalance === '0'
        && access.minimumRaw === '15000000000000000000000'
        && access.slotSize === '15000'
        && access.slotCount === 0
        && access.slotsUsed === 0
        && access.slotsAvailable === 0
        && access.requiredForNextLaunch === '15000'
        && access.enforcement === 'app_and_api'
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
const devCapacityProof = await page.evaluate(async ({ wallet }) => {
  const [accessResponse, profileResponse] = await Promise.all([
    fetch(`/api/v1/access/${wallet}`, { cache: 'no-store' }),
    fetch(`/api/v1/creators/${wallet}`, { cache: 'no-store' }),
  ])
  const access = await accessResponse.json()
  const profile = await profileResponse.json()
  return accessResponse.ok
    && profileResponse.ok
    && access.balance === '0'
    && access.walletBalance === '0'
    && access.bondedBalance === '0'
    && access.slotCount === 0
    && access.slotsUsed === 3
    && access.slotsAvailable === 0
    && access.overCapacity === 3
    && access.requiredForNextLaunch === '60000'
    && access.reason === 'below_minimum'
    && profile.creator_capacity?.overCapacity === 3
    && profile.agents?.length === 3
    && profile.featured_agent_ids?.length === 0
}, { wallet: expectedDevWallet })
results.devWalletCapacity = devCapacityProof
results.landingTitle = await page.title()
results.homeHeading = (await page.locator('.simple-home h1').innerText()).replace(/\s+/g, ' ').trim()
results.heroAgentCount = await page.locator('.pixel-agent').count()
results.homeObjectCount = await page.locator('.simple-home-objects article').count()
results.homeMuppetsBoundary = await page.getByText(/Unlocks creator slots. No claim on vault assets or yield/i).count() === 1
results.homeVaultBoundary = await page.getByText(/Represent the assets deposited into one Muppet vault/i).count() === 1
results.homeKeyBoundary = await page.getByText(/A separate speculative market. No claim on vault assets or yield/i).count() === 1
results.homeCreatorSlot = await page.getByText(/Hold 15,000 \$MUPPETS to unlock one creator slot/i).count() === 1
results.homeSeeWorkingHref = await page.getByRole('link', { name: 'See one working' }).getAttribute('href')
results.homeContractAddress = await page.locator('.simple-home-ca code').innerText()
results.homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
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
await page.screenshot({ path: new URL('home-clarity-first.png', screenshotDir).pathname, fullPage: false })

await page.goto(`${baseUrl}/about`, { waitUntil: 'networkidle' })
await page.waitForSelector('.hero h1')
results.aboutTitle = await page.title()
results.heroHeading = (await page.locator('.hero h1').innerText()).replace(/\s+/g, ' ').trim()
results.storyLeaves = await page.locator('.folio-index li').count()
results.strategyCards = await page.locator('.strategy-roles .type-grid article').count()
results.petPreviewCards = await page.locator('.landing-pet-card').count()
results.roadmapPhases = await page.locator('#roadmap .roadmap-card').count()
results.roadmapShipped = await page.locator('#roadmap .roadmap-card-shipped').count()
results.roadmapRepository = await page.getByRole('link', { name: /Public repository/i }).getAttribute('href')
results.roadmapBoundary = await page.getByText(/Shipped means live or published/i).count() === 1
results.explicitMainnetBoundary = await page.getByText(/unaudited contracts/i).count() > 0
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
await page.screenshot({ path: new URL('about-functional.png', screenshotDir).pathname, fullPage: false })

await page.close()
page = await desktop.newPage()
watch(page, 'create')
await page.goto(`${baseUrl}/app/create`, { waitUntil: 'networkidle' })
results.networkPillRemoved = await page.locator('.network-pill').count() === 0
results.createChainNumberRemoved = !((await page.locator('.create-page').innerText()).includes('4663'))
results.petPickerCount = await page.locator('.guided-pet-grid button').count()
results.builderProgressSteps = await page.locator('.guided-builder-steps > button').count()
results.descriptionInputs = await page.locator('textarea, input[name="description"]').count()
results.creatorSlotsOnLaunch = await page.getByRole('heading', { name: 'Creator Slots' }).count() === 1
results.creatorSlotMetricsOnLaunch = await page.locator('.creator-slots-grid > span').count()
results.appearanceCopy = await page.getByText(/does not change the vault, permissions or risk/i).count() === 1
results.nameRequired = await page.getByRole('button', { name: /Choose one job/i }).isDisabled()
await page.locator('.guided-name-field input').fill('browser gate')
await page.screenshot({ path: new URL('create-pet-and-name.png', screenshotDir).pathname, fullPage: false })
await page.getByRole('button', { name: /Choose one job/i }).click()
await page.getByText('What should its vault do?').waitFor()
results.taskPickerCount = await page.locator('.guided-job-grid > button').count()
results.candidateRoutesHidden = await page.getByText(/NVDA range|AAPL range|SPY range/i).count() === 0
results.stableJobVisible = await page.getByRole('button', { name: /Earn on stablecoins/i }).count() === 1
results.ethRangeSelectable = await page.getByRole('button', { name: /Run an ETH range/i }).count() === 1
results.launchReserveSelectable = await page.getByRole('button', { name: /Keep a launch reserve/i }).count() === 1
await page.getByRole('button', { name: /Run an ETH range/i }).click()
results.ethRangeSelected = await page.getByRole('button', { name: /Run an ETH range/i }).getAttribute('aria-pressed') === 'true'
results.jobAllocationVisible = await page.getByText(/up to 85% deployed/i).count() === 1
await page.getByText('Advanced details', { exact: true }).click()
results.advancedMarket = await page.getByText(/WETH · WETH \/ USDG/i).count() === 1
results.marketChecks = await page.locator('.guided-advanced-grid li').count()
results.noPromisedApy = await page.getByText(/no APY is promised/i).count() === 0
results.keyBoundaryBeforeLaunch = await page.getByText(/Keys do not own vault assets or receive vault yield/i).count() === 1
await page.screenshot({ path: new URL('create-live-jobs.png', screenshotDir).pathname, fullPage: false })
await page.getByRole('button', { name: /Review launch \+ funding/i }).click()
await page.getByText('Review the money path.').waitFor()
results.plannedFundField = await page.locator('.guided-fund-plan input').count() === 1
results.launchOneConfirmation = await page.getByText(/one wallet confirmation/i).count() === 1
results.fundingTwoConfirmations = await page.getByText(/asset approval \+ deposit/i).count() === 1
results.keyFieldsRemoved = await page.locator('.guided-launch-stage input').count() === 1
results.keyMarketClosedCopy = await page.getByText(/No Keys are approved or listed during launch/i).count() === 1
results.launchTokenGate = await page.getByText('15,000 $MUPPETS unlocks your next Creator Slot.', { exact: true }).count() === 1
results.launchGateConnect = await page.getByRole('button', { name: 'Connect wallet' }).count() === 1
const muppetsContractLink = page.getByRole('link', { name: `MUPPETS contract ${expectedMuppetsToken}` })
results.launchTokenAddressLink = await muppetsContractLink.count() === 1
  && (await muppetsContractLink.getAttribute('href')) === `https://robinhoodchain.blockscout.com/address/${expectedMuppetsToken}`
await page.screenshot({ path: new URL('create-launch-and-fund.png', screenshotDir).pathname, fullPage: false })

await page.close()
const commandCenter = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await useLaunchCommandFixture(commandCenter, launchCommandFixture)
const commandPage = await commandCenter.newPage()
watch(commandPage, 'command-center')
await commandPage.goto(`${baseUrl}/app/create`, { waitUntil: 'domcontentloaded' })
await commandPage.getByRole('heading', { name: 'Muppet live. Put the vault to work.' }).waitFor({ timeout: 60_000 })
results.commandCenterHeading = await commandPage.getByRole('heading', { name: 'Muppet live. Put the vault to work.' }).count() === 1
results.commandLaunchReceiptStages = await commandPage.locator('.single-launch-stage .launch-stage').count()
results.commandKeyReceiptStages = await commandPage.locator('.key-stage-list .launch-stage').count()
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
results.commandRecoveryDisclosure = await commandPage.getByText(/Public receipt metadata was saved in this browser/i).count() === 1
results.commandKeyMarketSeparate = await commandPage.getByText(/Agent Keys are speculative collectibles/i).count() === 1
results.commandKeyMarketOpen = await commandPage.getByText('market open', { exact: true }).count() === 1
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
results.launchRecoveryCopy = await recoveryPage.getByText(/saved the submitted receipt/i).count() === 1
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
const firstFollow = page.locator('.performance-market-row').first().getByRole('button', { name: /^Follow / })
results.marketFollowControl = await firstFollow.isVisible()
await firstFollow.click()
results.marketFollowPersisted = await page.evaluate(() => {
  const raw = window.localStorage.getItem('liquidmuppets-monitor:v1')
  if (!raw) return false
  const state = JSON.parse(raw)
  return Array.isArray(state.agentIds) && state.agentIds.length === 1 && state.agentIds[0] === 0
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
results.activityHasClaimedHandle = await page.locator('.public-activity-item .activity-actor').evaluateAll((actors) => (
  actors.some((actor) => actor.textContent?.trim().startsWith('@'))
))
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
results.performanceKeyRevenue = await page.getByRole('heading', { name: 'Revenue attached to this Key' }).count() === 1
results.performanceLegacyRevenueBoundary = await page.getByText('global only', { exact: true }).count() === 1
  && await page.getByText(/No per-Key volume, fee, reward or buyback number is inferred/i).count() === 1
results.performanceNoHistoricalApy = await page.getByText(/historical APY/i).count() === 0
results.performanceFollowControl = await page.getByRole('button', { name: /Follow range fox/i }).isVisible()
results.performanceOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: new URL('muppet-performance.png', screenshotDir).pathname, fullPage: false })

await page.close()
page = await desktop.newPage()
watch(page, 'proof-cards')
await page.goto(`${baseUrl}/app/proofs`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: 'Proof Cards.' }).waitFor({ timeout: 60_000 })
await page.locator('.proofs-grid-item').first().waitFor({ timeout: 60_000 })
const proofApiEvidence = await page.evaluate(async ({ tokenAddress }) => {
  const [proofResponse, pulseResponse] = await Promise.all([
    fetch('/api/v1/proofs?limit=100', { cache: 'no-store' }),
    fetch('/api/v1/pulse?limit=200', { cache: 'no-store' }),
  ])
  const proofs = await proofResponse.json()
  const pulse = await pulseResponse.json()
  const items = Array.isArray(proofs.items) ? proofs.items : []
  const holds = Array.isArray(pulse.items)
    ? pulse.items.filter((item) => item.action === 'keeper held')
    : []
  const detail = items.find((item) => item.market?.pool || item.market?.market_id) ?? items[0]
  return {
    ready: proofResponse.ok && pulseResponse.ok && items.length > 0,
    detailId: detail?.id ?? null,
    exactEvidence: items.every((item) => item.subject?.name
      && item.asset?.symbol
      && item.market?.health_status
      && item.timestamp
      && item.receipt?.state
      && String(item.token_address).toLowerCase() === tokenAddress.toLowerCase()),
    durableUrls: items.every((item) => item.public_url?.endsWith(`/proof/${item.id}`)
      && item.app_url?.endsWith(`/app/proof/${item.id}`)
      && item.image_url?.endsWith(`/api/v1/proofs/${item.id}/card.png`)),
    noApy: items.every((item) => item.no_apy_projection === true),
    dailySummary: items.some((item) => item.kind === 'keeper_daily_summary'
      && item.event_count > 1
      && item.receipt?.state === 'no_transaction'),
    pulseGrouped: holds.length > 1
      && holds.every((item) => item.proof_id && item.proof_url?.endsWith(`/proof/${item.proof_id}`))
      && new Set(holds.map((item) => item.proof_id)).size < holds.length,
  }
}, { tokenAddress: expectedMuppetsToken })
if (!proofApiEvidence.detailId) throw new Error('No durable Proof Card was available for browser QA.')
const proofDetailId = proofApiEvidence.detailId
results.proofApiReady = proofApiEvidence.ready
results.proofExactEvidence = proofApiEvidence.exactEvidence
results.proofDurableUrls = proofApiEvidence.durableUrls
results.proofNoApy = proofApiEvidence.noApy
results.proofDailySummary = proofApiEvidence.dailySummary
results.proofPulseGrouped = proofApiEvidence.pulseGrouped
results.proofGalleryCards = await page.locator('.proofs-grid-item').count()
results.proofFilterButtons = await page.getByRole('group', { name: 'Filter Proof Cards' }).locator('button').count()
results.proofGalleryPublicLinks = await page.getByRole('link', { name: 'Public URL' }).count()
results.proofGalleryShareLinks = await page.getByRole('link', { name: 'Share on X' }).count()
results.proofGalleryTokenAddress = await page.locator('.proof-card-visual footer code').evaluateAll((nodes, tokenAddress) => (
  nodes.every((node) => node.textContent?.toLowerCase() === String(tokenAddress).toLowerCase())
), expectedMuppetsToken)
results.proofGalleryOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: new URL('proof-cards-gallery.png', screenshotDir).pathname, fullPage: false })

await page.goto(`${baseUrl}/app/proof/${proofDetailId}`, { waitUntil: 'domcontentloaded' })
await page.locator('.proof-card-visual').waitFor({ timeout: 60_000 })
results.proofDetailEvent = await page.getByRole('heading', { name: 'What happened' }).count() === 1
results.proofDetailMarket = await page.getByRole('heading', { name: 'Latest observed health' }).count() === 1
results.proofDetailActions = await page.getByRole('button', { name: 'Copy proof URL' }).count() === 1
  && await page.getByRole('link', { name: 'Share on X' }).count() === 1
  && await page.getByRole('link', { name: 'Open card image' }).count() === 1
results.proofDetailBoundary = await page.getByText(/Recorded evidence only/i).count() > 0
  && await page.getByText(/no APY projection/i).count() > 0
results.proofDetailReceiptBoundary = await page.getByRole('link', { name: 'Open transaction receipt' }).count() === 1
  || await page.getByText(/No transaction was signed/i).count() > 0
results.proofDetailTokenAddress = (await page.locator('.proof-card-visual footer code').innerText()).toLowerCase() === expectedMuppetsToken.toLowerCase()
results.proofDetailOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
const proofServerEvidence = await page.evaluate(async ({ proofId, tokenAddress }) => {
  const [publicResponse, imageResponse, sourceResponse] = await Promise.all([
    fetch(`/proof/${proofId}`, { cache: 'no-store' }),
    fetch(`/api/v1/proofs/${proofId}/card.png`, { cache: 'no-store' }),
    fetch(`/api/v1/proofs/${proofId}/card.svg`, { cache: 'no-store' }),
  ])
  const [publicPage, imageBuffer, source] = await Promise.all([
    publicResponse.text(),
    imageResponse.arrayBuffer(),
    sourceResponse.text(),
  ])
  const signature = Array.from(new Uint8Array(imageBuffer).slice(0, 8)).join(',')
  return {
    publicPage: publicResponse.ok
      && publicResponse.headers.get('content-type')?.includes('text/html')
      && publicPage.includes('twitter:card')
      && publicPage.includes('og:image')
      && publicPage.includes('image/png')
      && publicPage.includes(`/app/proof/${proofId}`)
      && publicPage.toLowerCase().includes(tokenAddress.toLowerCase()),
    image: imageResponse.ok
      && imageResponse.headers.get('content-type')?.includes('image/png')
      && signature === '137,80,78,71,13,10,26,10'
      && imageBuffer.byteLength > 10_000,
    source: sourceResponse.ok
      && sourceResponse.headers.get('content-type')?.includes('image/svg+xml')
      && source.includes('width="1200" height="630"')
      && source.toLowerCase().includes(tokenAddress.toLowerCase()),
  }
}, { proofId: proofDetailId, tokenAddress: expectedMuppetsToken })
results.proofServerSharePage = proofServerEvidence.publicPage
results.proofGeneratedImage = proofServerEvidence.image
results.proofInspectableSvg = proofServerEvidence.source
await page.screenshot({ path: new URL('proof-card-detail.png', screenshotDir).pathname, fullPage: false })

await page.close()
page = await desktop.newPage()
watch(page, 'creator-slots')
await page.goto(`${baseUrl}/app/creator/${expectedDevWallet}`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: 'Creator Slots' }).waitFor({ timeout: 60_000 })
results.creatorSlotsUsed = await page.locator('.creator-slots-grid > span').filter({ hasText: 'slots used' }).locator('strong').innerText()
results.creatorSlotsAvailable = await page.locator('.creator-slots-grid > span').filter({ hasText: 'slots available' }).locator('strong').innerText()
results.creatorNextLaunchThreshold = await page.locator('.creator-slots-grid > span').filter({ hasText: 'next launch threshold' }).locator('strong').innerText()
results.creatorOverCapacity = await page.getByText('3 over capacity', { exact: true }).count() === 1
results.creatorFeaturedHeading = await page.getByRole('heading', { name: 'Featured Muppets' }).count() === 1
results.creatorFeaturedCards = await page.locator('.creator-featured-grid > article').count()
results.creatorFeaturedBoundary = await page.getByText(/All 3 Muppets remain in the full record/i).count() === 1
results.creatorLedgerRows = await page.locator('.creator-agent-row').count()
results.creatorKeySeparate = await page.getByRole('heading', { name: 'Agent Key markets' }).count() === 1
results.creatorProfileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: new URL('creator-slots-dev-wallet.png', screenshotDir).pathname, fullPage: false })

await page.close()
page = await desktop.newPage()
watch(page, 'monitor')
await page.goto(`${baseUrl}/app/watchlist`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: 'Watchlist.' }).waitFor({ timeout: 60_000 })
await page.locator('.watchlist-row').first().waitFor({ timeout: 60_000 })
results.monitorTitle = await page.title()
results.monitorFollowedRows = await page.locator('.watchlist-row').count()
results.monitorBrowserLocal = await page.getByText(/list and read state stay in this browser/i).count() === 1
results.monitorNoWalletNeeded = await page.getByText(/No wallet signature, account, or contract change/i).count() === 1
results.monitorWatchlistOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.getByRole('button', { name: /^Alerts/ }).click()
await page.locator('.monitor-alert').first().waitFor({ timeout: 60_000 })
results.monitorAlerts = await page.locator('.monitor-alert').count()
results.monitorAlertBoundaries = await page.locator('.monitor-alert').evaluateAll((items) => items.every((item) => {
  const footer = item.querySelector('.alert-body footer')
  return Boolean(footer?.querySelector('a[href*="/app/muppet/"]') || footer?.textContent?.includes('protocol-wide reserve record'))
    && Boolean(footer?.querySelector('a[href*="/tx/"]') || footer?.textContent?.includes('no transaction signed') || footer?.textContent?.includes('no receipt'))
}))
const markRead = page.getByRole('button', { name: /Mark all read/i })
results.monitorUnreadBefore = Number(await page.locator('.monitor-summary span').filter({ hasText: 'unread alerts' }).locator('strong').innerText())
await markRead.click()
results.monitorUnreadClears = (await page.locator('.monitor-summary span').filter({ hasText: 'unread alerts' }).locator('strong').innerText()) === '0'
await page.getByRole('button', { name: /Market Radar/ }).click()
await page.locator('.radar-row').first().waitFor({ timeout: 60_000 })
results.radarRows = await page.locator('.radar-row').count()
results.radarReadOnly = await page.getByText(/^Read-only\./).count() === 1
results.radarStatuses = await page.locator('.radar-status').allTextContents()
results.radarMissingStaysMissing = await page.getByText(/not exposed/i).count() > 0
results.radarExactMarkets = await page.locator('.radar-value.market a, .radar-value.market code').count() >= 2
results.radarNoExecution = await page.locator('.radar-panel').getByRole('button').count() === 0
results.radarEndpoint = await page.evaluate(async () => {
  const response = await fetch('/api/v1/market-radar', { cache: 'no-store' })
  const body = await response.json()
  return response.ok
    && Array.isArray(body.routes)
    && body.routes.length === 7
    && body.routes.every((route) => route.read_only === true && ['live', 'review', 'rejected'].includes(route.status))
    && body.routes.every((route) => route.volume_24h.value === null && route.costs.estimate.value === null)
})
results.monitorRadarOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: new URL('watchlist-market-radar.png', screenshotDir).pathname, fullPage: true })

await page.close()
page = await desktop.newPage()
watch(page, 'portfolio')
await page.goto(`${baseUrl}/app/portfolio`, { waitUntil: 'networkidle' })
results.portfolioHonestCopy = await page.getByText(/No estimated PnL/i).count() === 1
results.portfolioConnectState = await page.getByRole('heading', { name: 'Connect your wallet.' }).count() === 1
results.portfolioChainNumberRemoved = !((await page.locator('.portfolio-page').innerText()).includes('4663'))

await page.close()
page = await desktop.newPage()
watch(page, 'revenue')
await page.goto(`${baseUrl}/app/revenue`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: 'Revenue Engine.' }).waitFor({ timeout: 60_000 })
results.revenueTitle = await page.title()
results.revenuePending = await page.getByText('activation pending', { exact: true }).count() === 1
results.revenueFeeDestinations = await page.locator('.revenue-route-grid article').count()
results.revenueRouterSplits = await page.locator('.revenue-router-split > span').count()
results.revenueKeySplits = await page.locator('.revenue-key-split > span').count()
results.revenueKeyRoute = await page.getByRole('heading', { name: 'One Key, one revenue lane' }).count() === 1
results.revenueActivationChecks = await page.locator('.revenue-checks > span').count()
results.revenuePonsObserved = await page.getByText(/block [\d,]+/i).count() > 0
results.revenueBuybackOff = await page.getByText('off', { exact: true }).count() === 1
results.revenueNoReceipt = await page.getByText('No revenue receipt yet.', { exact: true }).count() === 1
results.revenueNoInventedHistory = await page.getByText(/does not backfill a pretend reward history or APY/i).count() === 1
results.revenueEpochMaturation = await page.getByText(/matures for seven days/i).count() > 0
results.revenueThreeTerms = await page.getByText(/30 days at 1x, 90 days at 1.25x, or 180 days at 1.5x/i).count() === 1
results.revenueReinvestmentPending = await page.getByRole('heading', { name: 'Claim WETH or buy more and stake.' }).count() === 1
  && await page.getByRole('button', { name: 'Buy more and stake · pending', exact: true }).isDisabled()
results.revenueEndpoint = await page.evaluate(async () => {
  const response = await fetch('/api/v1/revenue', { cache: 'no-store' })
  const body = await response.json()
  return response.ok
    && body.status === 'activation_pending'
    && body.pons?.available === true
    && body.pons?.buyback_enabled === false
    && Array.isArray(body.target_fee_route)
    && body.target_fee_route.length === 5
    && body.reward_unit?.muppets === '15000'
    && body.reinvestment?.available === false
    && body.reinvestment?.capability === 'claim_buy_and_bond'
    && body.reinvestment?.version === 1
    && body.reinvestment?.maximum_deadline_seconds === 300
    && body.reward_unit?.maturation_days === 7
    && body.reward_unit?.epoch_days === 7
    && Array.isArray(body.reward_unit?.terms)
    && body.reward_unit.terms.map((term) => `${term.days}:${term.weight}`).join(',') === '30:1x,90:1.25x,180:1.5x'
    && body.router_split?.agent_bonds === '50%'
    && body.router_split?.stock_reserve === '30%'
    && body.router_split?.operations === '20%'
    && body.key_market_split?.agent_bond_weth === '50%'
    && body.key_market_split?.muppets_buyback === '25%'
    && body.router?.deployed === false
    && body.bond?.deployed === false
    && body.buyback?.deployed === false
    && Array.isArray(body.receipts)
    && body.receipts.length === 0
})
results.revenueOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: new URL('revenue-engine.png', screenshotDir).pathname, fullPage: true })

await page.close()
page = await desktop.newPage()
watch(page, 'docs')
await page.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle' })
results.docsTitle = await page.title()
results.docsSections = await page.locator('.docs-layout article > section').count()
results.docsTokenGate = await page.getByRole('heading', { name: '$MUPPETS Creator Slots' }).count() === 1
results.docsCreatorSlotFormula = await page.getByText(/floor\(\(liquid balance \+ Agent-Bonded balance\) \/ 15,000\)/i).count() === 1
results.docsSimpleCreator = await page.getByText(/Creation now has three stages/i).count() === 1
results.docsOptionalKeyMarket = await page.getByText(/Opening an Agent Key market is optional and separate after launch/i).count() === 1
results.docsSevenPets = await page.getByRole('heading', { name: 'Seven pets, three live tasks' }).count() === 1
results.docsFeeReserve = await page.getByRole('heading', { name: 'Marketplace fee reserve' }).count() === 1
results.docsRevenue = await page.getByRole('heading', { name: 'Revenue Engine and Agent Bonds' }).count() === 1
results.docsRevenueBoundary = await page.getByText(/not yet deployed on mainnet/i).count() === 1
results.docsBondEpochs = await page.getByText(/positions mature for seven days and earn only for full weekly epochs/i).count() === 1
results.docsFactorySizeBoundary = await page.getByText(/exceeds the EIP-170 runtime-size limit/i).count() === 1
results.docsPerformance = await page.getByRole('heading', { name: 'Public Muppet performance' }).count() === 1
results.docsPerformanceMarketplace = await page.getByText(/select any two Muppets to compare/i).count() === 1
results.docsCreatorProfiles = await page.getByText(/Every creator wallet has a shareable/i).count() === 1
results.docsSystemPulse = await page.getByText(/combines decoded transaction events and recorded keeper decisions/i).count() === 1
results.docsProofCards = await page.getByRole('heading', { name: 'Automatic Muppet Proof Cards' }).count() === 1
results.docsMonitor = await page.getByRole('heading', { name: 'Watchlists and Market Radar' }).count() === 1
results.docsAlgorithm = await page.getByRole('heading', { name: 'The backend algorithm' }).count() === 1
results.docsRoadmap = await page.getByRole('heading', { name: 'Public roadmap' }).count() === 1
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
await degradedPage.locator('.guided-name-field input').fill('degraded test')
await degradedPage.getByRole('button', { name: /Choose one job/i }).click()
await degradedPage.getByText('What should its vault do?').waitFor()
results.degradedTaskPickerCount = await degradedPage.locator('.guided-job-grid > button').count()
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
await mobilePage.locator('.guided-name-field input').fill('mobile fox')
await mobilePage.getByRole('button', { name: /Choose one job/i }).click()
await mobilePage.getByRole('button', { name: /Run an ETH range/i }).click()
results.mobileJobOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobileJobColumns = await mobilePage.locator('.guided-job-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
await mobilePage.getByRole('button', { name: /Review launch \+ funding/i }).click()
await mobilePage.getByText('Review the money path.').waitFor()
results.mobileLaunchOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobilePage.screenshot({ path: new URL('launch-mobile.png', screenshotDir).pathname, fullPage: false })
await mobilePage.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle' })
results.mobileDocsOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobilePage.goto(`${baseUrl}/app/revenue`, { waitUntil: 'networkidle' })
await mobilePage.getByRole('heading', { name: 'Revenue Engine.' }).waitFor({ timeout: 60_000 })
results.mobileRevenueOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await mobilePage.goto(`${baseUrl}/app/muppet/1`, { waitUntil: 'domcontentloaded' })
await mobilePage.getByRole('heading', { name: 'range fox' }).waitFor({ timeout: 60_000 })
results.mobilePerformanceOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobilePerformanceKeyVisible = await mobilePage.getByRole('heading', { name: 'Agent Key market' }).count() === 1
await mobilePage.goto(`${baseUrl}/app/creator/${expectedDevWallet}`, { waitUntil: 'domcontentloaded' })
await mobilePage.getByRole('heading', { name: 'Creator Slots' }).waitFor({ timeout: 60_000 })
results.mobileCreatorOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobileCreatorSlotColumns = await mobilePage.locator('.creator-slots-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
await mobilePage.goto(`${baseUrl}/app/proofs`, { waitUntil: 'domcontentloaded' })
await mobilePage.locator('.proofs-grid-item').first().waitFor({ timeout: 60_000 })
results.mobileProofOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobileProofColumns = await mobilePage.locator('.proofs-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
await mobilePage.goto(`${baseUrl}/app/watchlist`, { waitUntil: 'domcontentloaded' })
await mobilePage.getByRole('heading', { name: 'Watchlist.' }).waitFor({ timeout: 60_000 })
await mobilePage.getByRole('button', { name: /Market Radar/ }).click()
await mobilePage.locator('.radar-row').first().waitFor({ timeout: 60_000 })
results.mobileMonitorOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.mobileRadarScrollsInside = await mobilePage.locator('.radar-table-wrap').evaluate((node) => node.scrollWidth > node.clientWidth)
results.mobileNavItems = await mobilePage.locator('.mobile-app-nav button').count()
results.mobileNavSingleRow = await mobilePage.locator('.mobile-app-nav').evaluate((node) => (
  getComputedStyle(node).gridTemplateRows.split(' ').length === 1
))
await mobilePage.screenshot({ path: new URL('market-radar-mobile.png', screenshotDir).pathname, fullPage: false })
await mobile.close()

const mobileCommand = await mobileBrowser.newContext({ viewport: { width: 320, height: 720 } })
await useLaunchCommandFixture(mobileCommand, launchCommandFixture)
const mobileCommandPage = await mobileCommand.newPage()
watch(mobileCommandPage, 'command-center-320px')
await mobileCommandPage.goto(`${baseUrl}/app/create`, { waitUntil: 'domcontentloaded' })
await mobileCommandPage.getByRole('heading', { name: 'Muppet live. Put the vault to work.' }).waitFor({ timeout: 60_000 })
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
await narrowPage.goto(`${baseUrl}/app/revenue`, { waitUntil: 'networkidle' })
await narrowPage.getByRole('heading', { name: 'Revenue Engine.' }).waitFor({ timeout: 60_000 })
results.narrowRevenueOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await narrowPage.goto(`${baseUrl}/app/muppet/1`, { waitUntil: 'domcontentloaded' })
await narrowPage.getByRole('heading', { name: 'range fox' }).waitFor({ timeout: 60_000 })
results.narrowPerformanceOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await narrowPage.goto(`${baseUrl}/app/proof/${proofDetailId}`, { waitUntil: 'domcontentloaded' })
await narrowPage.locator('.proof-card-visual').waitFor({ timeout: 60_000 })
results.narrowProofOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.narrowProofColumns = await narrowPage.locator('.proof-detail-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
await narrowPage.goto(`${baseUrl}/app/creator/${expectedDevWallet}`, { waitUntil: 'domcontentloaded' })
await narrowPage.getByRole('heading', { name: 'Creator Slots' }).waitFor({ timeout: 60_000 })
results.narrowCreatorOverflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
results.narrowCreatorSlotColumns = await narrowPage.locator('.creator-slots-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
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
    && results.marketFollowControl
    && results.marketFollowPersisted
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
    && results.activityHasClaimedHandle
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
  || results.homeHeading !== 'A Muppet is an onchain vault with one job.'
  || results.homeObjectCount !== 3
  || !results.homeMuppetsBoundary
  || !results.homeVaultBoundary
  || !results.homeKeyBoundary
  || !results.homeCreatorSlot
  || results.homeSeeWorkingHref !== '/app/muppet/0'
  || results.homeContractAddress.toLowerCase() !== expectedMuppetsToken.toLowerCase()
  || results.homeOverflow
  || results.aboutTitle !== 'How LIQUIDMUPPETS works'
  || results.heroHeading !== 'Muppets work. You set the limits.'
  || results.heroAgentCount !== 3
  || results.storyLeaves !== 4
  || results.strategyCards !== 3
  || results.petPreviewCards !== 7
  || results.roadmapPhases !== 4
  || results.roadmapShipped !== 1
  || results.roadmapRepository !== 'https://github.com/juicevz/liquidmuppets'
  || !results.roadmapBoundary
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
  || !results.devWalletCapacity
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
  || results.builderProgressSteps !== 3
  || results.descriptionInputs !== 0
  || !results.creatorSlotsOnLaunch
  || results.creatorSlotMetricsOnLaunch !== 5
  || !results.appearanceCopy
  || !results.nameRequired
  || results.taskPickerCount !== 3
  || !results.candidateRoutesHidden
  || !results.stableJobVisible
  || !results.ethRangeSelectable
  || !results.launchReserveSelectable
  || !results.ethRangeSelected
  || !results.jobAllocationVisible
  || !results.advancedMarket
  || results.marketChecks !== 3
  || !results.noPromisedApy
  || !results.keyBoundaryBeforeLaunch
  || !results.plannedFundField
  || !results.launchOneConfirmation
  || !results.fundingTwoConfirmations
  || !results.keyFieldsRemoved
  || !results.keyMarketClosedCopy
  || !results.launchTokenGate
  || !results.launchGateConnect
  || !results.launchTokenAddressLink
  || !results.commandCenterHeading
  || results.commandLaunchReceiptStages !== 1
  || results.commandKeyReceiptStages !== 2
  || results.commandConfirmedStages !== 3
  || !results.commandFundAction
  || !results.commandSharePreview
  || !results.commandKeeperTiming
  || results.commandPerformanceHref !== '/app/muppet/0'
  || !results.commandShareHref?.startsWith('https://x.com/intent/post?')
  || !results.commandRecoveryDisclosure
  || !results.commandKeyMarketSeparate
  || !results.commandKeyMarketOpen
  || results.commandCenterOverflow
  || !results.launchRecoveryAction
  || results.launchRecoverySubmitted !== 1
  || results.launchRecoveryWaiting !== 0
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
  || !results.performanceKeyRevenue
  || !results.performanceLegacyRevenueBoundary
  || !results.performanceNoHistoricalApy
  || !results.performanceFollowControl
  || results.performanceOverflow
  || !results.proofApiReady
  || !results.proofExactEvidence
  || !results.proofDurableUrls
  || !results.proofNoApy
  || !results.proofDailySummary
  || !results.proofPulseGrouped
  || results.proofGalleryCards < 1
  || results.proofFilterButtons !== 9
  || results.proofGalleryPublicLinks !== results.proofGalleryCards
  || results.proofGalleryShareLinks !== results.proofGalleryCards
  || !results.proofGalleryTokenAddress
  || results.proofGalleryOverflow
  || !results.proofDetailEvent
  || !results.proofDetailMarket
  || !results.proofDetailActions
  || !results.proofDetailBoundary
  || !results.proofDetailReceiptBoundary
  || !results.proofDetailTokenAddress
  || results.proofDetailOverflow
  || !results.proofServerSharePage
  || !results.proofGeneratedImage
  || !results.proofInspectableSvg
  || results.creatorSlotsUsed !== '3'
  || results.creatorSlotsAvailable !== '0'
  || results.creatorNextLaunchThreshold !== '60,000 $MUPPETS'
  || !results.creatorOverCapacity
  || !results.creatorFeaturedHeading
  || results.creatorFeaturedCards !== 0
  || !results.creatorFeaturedBoundary
  || results.creatorLedgerRows !== 3
  || !results.creatorKeySeparate
  || results.creatorProfileOverflow
  || results.monitorTitle !== 'Watchlist and Market Radar | LIQUIDMUPPETS'
  || results.monitorFollowedRows !== 1
  || !results.monitorBrowserLocal
  || !results.monitorNoWalletNeeded
  || results.monitorWatchlistOverflow
  || results.monitorAlerts < 1
  || !results.monitorAlertBoundaries
  || results.monitorUnreadBefore < 1
  || !results.monitorUnreadClears
  || results.radarRows !== 7
  || !results.radarReadOnly
  || !results.radarStatuses.every((status) => /live|review|rejected/i.test(status))
  || !results.radarMissingStaysMissing
  || !results.radarExactMarkets
  || !results.radarNoExecution
  || !results.radarEndpoint
  || results.monitorRadarOverflow
  || !results.portfolioHonestCopy
  || !results.portfolioConnectState
  || !results.portfolioChainNumberRemoved
  || results.revenueTitle !== 'Revenue Engine | LIQUIDMUPPETS'
  || !results.revenuePending
  || results.revenueFeeDestinations !== 5
  || results.revenueRouterSplits !== 4
  || results.revenueKeySplits !== 4
  || !results.revenueKeyRoute
  || results.revenueActivationChecks !== 6
  || !results.revenuePonsObserved
  || !results.revenueBuybackOff
  || !results.revenueNoReceipt
  || !results.revenueNoInventedHistory
  || !results.revenueEpochMaturation
  || !results.revenueThreeTerms
  || !results.revenueReinvestmentPending
  || !results.revenueEndpoint
  || results.revenueOverflow
  || results.docsTitle !== 'Docs | LIQUIDMUPPETS'
  || results.docsSections !== 22
  || !results.docsTokenGate
  || !results.docsCreatorSlotFormula
  || !results.docsSimpleCreator
  || !results.docsOptionalKeyMarket
  || !results.docsSevenPets
  || !results.docsFeeReserve
  || !results.docsRevenue
  || !results.docsRevenueBoundary
  || !results.docsBondEpochs
  || !results.docsFactorySizeBoundary
  || !results.docsPerformance
  || !results.docsPerformanceMarketplace
  || !results.docsCreatorProfiles
  || !results.docsSystemPulse
  || !results.docsProofCards
  || !results.docsMonitor
  || !results.docsAlgorithm
  || !results.docsRoadmap
  || !results.docsBoundary
  || !results.docsLiveContracts
  || results.docsVisuals !== 9
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
  || results.mobileJobOverflow
  || results.mobileJobColumns !== 1
  || results.mobileLaunchOverflow
  || results.mobileDocsOverflow
  || results.mobileRevenueOverflow
  || results.mobilePerformanceOverflow
  || !results.mobilePerformanceKeyVisible
  || results.mobileCreatorOverflow
  || results.mobileCreatorSlotColumns !== 2
  || results.mobileProofOverflow
  || results.mobileProofColumns !== 1
  || results.mobileMonitorOverflow
  || !results.mobileRadarScrollsInside
  || results.mobileNavItems !== 7
  || !results.mobileNavSingleRow
  || !results.mobileNavVisible
  || results.mobileCommandCenterOverflow
  || results.mobileCommandColumns !== 1
  || results.narrowAppOverflow
  || !results.narrowCompareButtonVisible
  || results.narrowComparisonColumns !== 1
  || results.narrowDocsOverflow
  || results.narrowRevenueOverflow
  || results.narrowPerformanceOverflow
  || results.narrowProofOverflow
  || results.narrowProofColumns !== 1
  || results.narrowCreatorOverflow
  || results.narrowCreatorSlotColumns !== 1
  || !results.narrowHeaderVisible
  || results.degradedTaskPickerCount !== 3
  || !results.degradedTaskWarning
  || consoleErrors.length > 0

if (failed) process.exitCode = 1

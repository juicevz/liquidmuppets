import type { WalletProvider } from '../types'

const robinhoodChain = {
  chainId: '0x1237',
  chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
  blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
}

function getProvider(): WalletProvider | undefined {
  return window.ethereum
}

export async function connectWallet(): Promise<string> {
  const provider = getProvider()
  if (!provider) throw new Error('NO_PROVIDER')

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const account = accounts[0]
  if (!account) throw new Error('NO_ACCOUNT')

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: robinhoodChain.chainId }],
    })
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code !== 4902) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [robinhoodChain],
    })
  }

  return account
}

export async function getConnectedWallet(): Promise<string | null> {
  const provider = getProvider()
  if (!provider) return null
  const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
  return accounts[0] ?? null
}

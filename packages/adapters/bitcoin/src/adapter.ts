import {
  CoreHelperUtil,
  WcHelpersUtil,
  type AppKit,
  type AppKitOptions,
  type Provider
} from '@reown/appkit'
import { AdapterBlueprint } from '@reown/appkit/adapters'
import type { BitcoinConnector } from './utils/BitcoinConnector.js'
import type UniversalProvider from '@walletconnect/universal-provider'
import { SatsConnectConnector } from './connectors/SatsConnectConnector.js'
import { WalletStandardConnector } from './connectors/WalletStandardConnector.js'
import { WalletConnectProvider } from './utils/WalletConnectProvider.js'
import { LeatherConnector } from './connectors/LeatherConnector.js'
import { OKXConnector } from './connectors/OKXConnector.js'
import { UnitsUtil } from './utils/UnitsUtil.js'
import { BitcoinApi } from './utils/BitcoinApi.js'
import { bitcoin } from '@reown/appkit/networks'

export class BitcoinAdapter extends AdapterBlueprint<BitcoinConnector> {
  private eventsToUnbind: (() => void)[] = []
  private api: BitcoinApi.Interface

  constructor({ api = {}, ...params }: BitcoinAdapter.ConstructorParams = {}) {
    super({
      namespace: 'bip122',
      ...params
    })

    this.api = {
      ...BitcoinApi,
      ...api
    }
  }

  public async connectWalletConnect(onUri: (uri: string) => void): Promise<void> {
    const connector = this.connectors.find(c => c.type === 'WALLET_CONNECT')
    const provider = connector?.provider as UniversalProvider
    if (!this.caipNetworks || !provider) {
      throw new Error(
        'UniversalAdapter:connectWalletConnect - caipNetworks or provider is undefined'
      )
    }

    provider.on('display_uri', (uri: string) => {
      onUri(uri)
    })

    const namespaces = WcHelpersUtil.createNamespaces(this.caipNetworks)
    await provider.connect({ optionalNamespaces: namespaces })
  }

  override async connect(
    params: AdapterBlueprint.ConnectParams
  ): Promise<AdapterBlueprint.ConnectResult> {
    const connector = this.connectors.find(c => c.id === params.id)
    if (!connector) {
      throw new Error('connectionControllerClient:connectExternal - connector is undefined')
    }

    const address = await connector.connect()

    this.connector = connector
    this.bindEvents(this.connector)

    const chain = connector.chains.find(c => c.id === params.chainId) || connector.chains[0]

    if (!chain) {
      throw new Error('The connector does not support any of the requested chains')
    }

    return {
      id: connector.id,
      type: connector.type,
      address,
      chainId: chain.id,
      provider: connector.provider
    }
  }
  override async getAccounts(
    params: AdapterBlueprint.GetAccountsParams
  ): Promise<AdapterBlueprint.GetAccountsResult> {
    const addresses = await this.connectors
      .find(connector => connector.id === params.id)
      ?.getAccountAddresses()
      .catch(() => [])

    const accounts = addresses?.map(a =>
      CoreHelperUtil.createAccount('bip122', a.address, a.purpose || 'payment')
    )

    return {
      accounts: accounts || []
    }
  }
  override syncConnectors(_options?: AppKitOptions, appKit?: AppKit): void {
    function getActiveNetwork() {
      return appKit?.getCaipNetwork()
    }

    WalletStandardConnector.watchWallets({
      callback: this.addConnector.bind(this),
      requestedChains: this.networks
    })

    this.addConnector(
      ...SatsConnectConnector.getWallets({
        requestedChains: this.networks,
        getActiveNetwork
      }).map(connector => {
        switch (connector.wallet.id) {
          case LeatherConnector.ProviderId:
            return new LeatherConnector({
              connector
            })

          default:
            return connector
        }
      })
    )

    const okxConnector = OKXConnector.getWallet({
      requestedChains: this.networks,
      getActiveNetwork
    })
    if (okxConnector) {
      this.addConnector(okxConnector)
    }
  }

  override syncConnection(
    params: AdapterBlueprint.SyncConnectionParams
  ): Promise<AdapterBlueprint.ConnectResult> {
    return this.connect({
      id: params.id,
      chainId: params.chainId,
      type: ''
    })
  }

  override async signMessage(
    params: AdapterBlueprint.SignMessageParams
  ): Promise<AdapterBlueprint.SignMessageResult> {
    const connector = params.provider as BitcoinConnector

    if (!connector) {
      throw new Error('BitcoinAdapter:signMessage - connector is undefined')
    }

    const signature = await connector.signMessage({
      message: params.message,
      address: params.address
    })

    return { signature }
  }

  public getWalletConnectProvider(
    params: AdapterBlueprint.GetWalletConnectProviderParams
  ): AdapterBlueprint.GetWalletConnectProviderResult {
    const walletConnectProvider = new WalletConnectProvider({
      provider: params.provider as UniversalProvider,
      chains: params.caipNetworks,
      getActiveChain: () => params.activeCaipNetwork
    })

    return walletConnectProvider as unknown as Provider
  }

  override switchNetwork(_params: AdapterBlueprint.SwitchNetworkParams): Promise<void> {
    // Switch network
    return Promise.resolve()
  }

  override async disconnect(params: AdapterBlueprint.DisconnectParams): Promise<void> {
    if (params?.provider) {
      await params.provider.disconnect()
    } else if (this.connector) {
      await this.connector.disconnect()
    }
    this.unbindEvents()
  }

  override async getBalance(
    params: AdapterBlueprint.GetBalanceParams
  ): Promise<AdapterBlueprint.GetBalanceResult> {
    const network = params.caipNetwork

    if (network?.chainNamespace === 'bip122') {
      const utxos = await this.api.getUTXOs({
        network,
        address: params.address
      })

      const balance = utxos.reduce((acc, utxo) => acc + utxo.value, 0)

      return {
        balance: UnitsUtil.parseSatoshis(balance.toString(), network),
        symbol: network.nativeCurrency.symbol
      }
    }

    // Get balance
    return Promise.resolve({
      balance: '0',
      symbol: bitcoin.nativeCurrency.symbol
    })
  }

  // -- Unused => Refactor ------------------------------------------- //

  override getProfile(
    _params: AdapterBlueprint.GetProfileParams
  ): Promise<AdapterBlueprint.GetProfileResult> {
    // Get profile
    return Promise.resolve({} as unknown as AdapterBlueprint.GetProfileResult)
  }

  override estimateGas(
    _params: AdapterBlueprint.EstimateGasTransactionArgs
  ): Promise<AdapterBlueprint.EstimateGasTransactionResult> {
    // Estimate gas
    return Promise.resolve({} as unknown as AdapterBlueprint.EstimateGasTransactionResult)
  }

  override sendTransaction(
    _params: AdapterBlueprint.SendTransactionParams
  ): Promise<AdapterBlueprint.SendTransactionResult> {
    // Send transaction
    return Promise.resolve({} as unknown as AdapterBlueprint.SendTransactionResult)
  }

  override writeContract(
    _params: AdapterBlueprint.WriteContractParams
  ): Promise<AdapterBlueprint.WriteContractResult> {
    // Write contract
    return Promise.resolve({} as unknown as AdapterBlueprint.WriteContractResult)
  }

  override getEnsAddress(
    _params: AdapterBlueprint.GetEnsAddressParams
  ): Promise<AdapterBlueprint.GetEnsAddressResult> {
    // Get ENS address
    return Promise.resolve({} as unknown as AdapterBlueprint.GetEnsAddressResult)
  }

  override parseUnits(_params: AdapterBlueprint.ParseUnitsParams): bigint {
    // Parse units
    return BigInt(0)
  }

  override formatUnits(_params: AdapterBlueprint.FormatUnitsParams): string {
    // Format units
    return ''
  }

  override grantPermissions(_params: AdapterBlueprint.GrantPermissionsParams): Promise<unknown> {
    // Grant permissions
    return Promise.resolve({})
  }

  override getCapabilities(_params: AdapterBlueprint.GetCapabilitiesParams): Promise<unknown> {
    // Revoke permissions
    return Promise.resolve({})
  }

  override revokePermissions(
    _params: AdapterBlueprint.RevokePermissionsParams
  ): Promise<`0x${string}`> {
    // Get capabilities
    return Promise.resolve('0x')
  }

  // -- Private ------------------------------------------ //
  private bindEvents(connector: BitcoinConnector) {
    this.unbindEvents()

    const accountsChanged = (data: string[]) => {
      const [newAccount] = data
      if (newAccount) {
        this.emit('accountChanged', {
          address: newAccount
        })
      }
    }
    connector.on('accountsChanged', accountsChanged)
    this.eventsToUnbind.push(() => connector.removeListener('accountsChanged', accountsChanged))

    const chainChanged = (data: string) => {
      this.emit('switchNetwork', { chainId: data })
    }
    connector.on('chainChanged', chainChanged)
    this.eventsToUnbind.push(() => connector.removeListener('chainChanged', chainChanged))

    const disconnect = () => {
      this.emit('disconnect')
    }
    connector.on('disconnect', disconnect)
    this.eventsToUnbind.push(() => connector.removeListener('disconnect', disconnect))
  }

  private unbindEvents() {
    this.eventsToUnbind.forEach(unsubscribe => unsubscribe())
    this.eventsToUnbind = []
  }
}

export namespace BitcoinAdapter {
  export type ConstructorParams = Omit<AdapterBlueprint.Params, 'namespace'> & {
    api?: Partial<BitcoinApi.Interface>
  }
}

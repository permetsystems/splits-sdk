import {
  BaseClientMixin,
  BaseGasEstimatesMixin,
  BaseTransactions,
} from './base'
import {
  TransactionType,
  PASS_THROUGH_WALLET_CHAIN_IDS,
  getPassThroughWalletFactoryAddress,
} from '../constants'
import {
  InvalidAuthError,
  TransactionFailedError,
  UnsupportedChainIdError,
} from '../errors'
import { applyMixins } from './mixin'
import type {
  CallData,
  CreatePassThroughWalletConfig,
  PassThroughTokensConfig,
  PassThroughWalletExecCallsConfig,
  PassThroughWalletPauseConfig,
  SetPassThroughConfig,
  SplitsClientConfig,
  TransactionConfig,
  TransactionFormat,
} from '../types'
import { getTransactionEvents } from '../utils'
import { validateAddress } from '../utils/validation'
import { passThroughWalletFactoryAbi } from '../constants/abi/passThroughWalletFactory'
import {
  Hash,
  Hex,
  Log,
  decodeEventLog,
  encodeEventTopics,
  getAddress,
  getContract,
} from 'viem'
import { passThroughWalletAbi } from '../constants/abi/passThroughWallet'

class PassThroughWalletTransactions extends BaseTransactions {
  constructor({
    transactionType,
    chainId,
    publicClient,
    ensProvider,
    account,
    includeEnsNames = false,
  }: SplitsClientConfig & TransactionConfig) {
    super({
      transactionType,
      chainId,
      publicClient,
      ensProvider,
      account,
      includeEnsNames,
    })
  }

  protected async _createPassThroughWalletTransaction({
    owner,
    paused = false,
    passThrough,
    transactionOverrides = {},
  }: CreatePassThroughWalletConfig): Promise<TransactionFormat> {
    validateAddress(owner)
    validateAddress(passThrough)
    if (this._shouldRequireSigner) this._requireSigner()

    const result = await this._executeContractFunction({
      contractAddress: getPassThroughWalletFactoryAddress(this._chainId),
      contractAbi: passThroughWalletFactoryAbi,
      functionName: 'createPassThroughWallet',
      functionArgs: [owner, paused, passThrough],
      transactionOverrides,
    })

    return result
  }

  protected async _passThroughTokensTransaction({
    passThroughWalletId,
    tokens,
    transactionOverrides = {},
  }: PassThroughTokensConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletId)
    tokens.map((token) => validateAddress(token))
    if (this._shouldRequireSigner) this._requireSigner()

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletId),
      contractAbi: passThroughWalletAbi,
      functionName: 'passThroughTokens',
      functionArgs: [tokens],
      transactionOverrides,
    })

    return result
  }

  protected async _setPassThroughTransaction({
    passThroughWalletId,
    passThrough,
    transactionOverrides = {},
  }: SetPassThroughConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletId)
    validateAddress(passThrough)
    if (this._shouldRequireSigner) {
      this._requireSigner()
      await this._requireOwner(passThroughWalletId)
    }

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletId),
      contractAbi: passThroughWalletAbi,
      functionName: 'setPassThrough',
      functionArgs: [passThrough],
      transactionOverrides,
    })

    return result
  }

  protected async _setPausedTransaction({
    passThroughWalletId,
    paused,
    transactionOverrides = {},
  }: PassThroughWalletPauseConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletId)
    if (this._shouldRequireSigner) {
      this._requireSigner()
      await this._requireOwner(passThroughWalletId)
    }

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletId),
      contractAbi: passThroughWalletAbi,
      functionName: 'setPaused',
      functionArgs: [paused],
      transactionOverrides,
    })

    return result
  }

  protected async _execCallsTransaction({
    passThroughWalletId,
    calls,
    transactionOverrides = {},
  }: PassThroughWalletExecCallsConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletId)
    calls.map((callData) => validateAddress(callData.to))
    if (this._shouldRequireSigner) {
      this._requireSigner()
      await this._requireOwner(passThroughWalletId)
    }

    const formattedCalls = calls.map((callData) => {
      return [callData.to, callData.value, callData.data]
    })

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletId),
      contractAbi: passThroughWalletAbi,
      functionName: 'execCalls',
      functionArgs: [formattedCalls],
      transactionOverrides,
    })

    return result
  }

  private async _requireOwner(passThroughWalletId: string) {
    const passThroughWalletContract =
      this._getPassThroughWalletContract(passThroughWalletId)
    const owner = await passThroughWalletContract.read.owner()
    // TODO: how to get rid of this, needed for typescript check
    if (!this._signer?.account) throw new Error()

    const signerAddress = this._signer.account?.address

    if (owner !== signerAddress)
      throw new InvalidAuthError(
        `Action only available to the pass through wallet owner. Pass through wallet id: ${passThroughWalletId}, owner: ${owner}, signer: ${signerAddress}`,
      )
  }

  protected _getPassThroughWalletContract(passThroughWallet: string) {
    return getContract({
      address: getAddress(passThroughWallet),
      abi: passThroughWalletAbi,
      publicClient: this._provider,
    })
  }

  private _getPassThroughWalletFactoryContract() {
    return getContract({
      address: getPassThroughWalletFactoryAddress(this._chainId),
      abi: passThroughWalletFactoryAbi,
      publicClient: this._provider,
    })
  }
}

export class PassThroughWalletClient extends PassThroughWalletTransactions {
  readonly eventTopics: { [key: string]: Hex[] }
  readonly callData: PassThroughWalletCallData
  readonly estimateGas: PassThroughWalletGasEstimates

  constructor({
    chainId,
    publicClient,
    ensProvider,
    account,
    includeEnsNames = false,
  }: SplitsClientConfig) {
    super({
      transactionType: TransactionType.Transaction,
      chainId,
      publicClient,
      ensProvider,
      account,
      includeEnsNames,
    })

    if (!PASS_THROUGH_WALLET_CHAIN_IDS.includes(chainId))
      throw new UnsupportedChainIdError(chainId, PASS_THROUGH_WALLET_CHAIN_IDS)

    this.eventTopics = {
      createPassThroughWallet: [
        encodeEventTopics({
          abi: passThroughWalletFactoryAbi,
          eventName: 'CreatePassThroughWallet',
        })[0],
      ],
      passThroughTokens: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'PassThrough',
        })[0],
      ],
      setPassThrough: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'SetPassThrough',
        })[0],
      ],
      setPaused: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'SetPaused',
        })[0],
      ],
      execCalls: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'ExecCalls',
        })[0],
      ],
    }

    this.callData = new PassThroughWalletCallData({
      chainId,
      publicClient,
      ensProvider,
      account,
      includeEnsNames,
    })
    this.estimateGas = new PassThroughWalletGasEstimates({
      chainId,
      publicClient,
      ensProvider,
      account,
      includeEnsNames,
    })
  }

  // Write actions
  async submitCreatePassThroughWalletTransaction({
    owner,
    paused,
    passThrough,
  }: CreatePassThroughWalletConfig): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._createPassThroughWalletTransaction({
      owner,
      paused,
      passThrough,
    })
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async createPassThroughWallet({
    owner,
    paused,
    passThrough,
  }: CreatePassThroughWalletConfig): Promise<{
    passThroughWalletId: string
    event: Log
  }> {
    this._requireProvider()
    if (!this._provider) throw new Error()

    const { txHash } = await this.submitCreatePassThroughWalletTransaction({
      owner,
      paused,
      passThrough,
    })
    const events = await getTransactionEvents(
      this._provider,
      txHash,
      this.eventTopics.createPassThroughWallet,
    )
    const event = events.length > 0 ? events[0] : undefined
    if (event) {
      const log = decodeEventLog({
        abi: passThroughWalletFactoryAbi,
        data: event.data,
        topics: event.topics,
      })
      return {
        passThroughWalletId: log.args.passThroughWallet,
        event,
      }
    }

    throw new TransactionFailedError()
  }

  async submitPassThroughTokensTransaction({
    passThroughWalletId,
    tokens,
  }: PassThroughTokensConfig): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._passThroughTokensTransaction({
      passThroughWalletId,
      tokens,
    })
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async passThroughTokens({
    passThroughWalletId,
    tokens,
  }: PassThroughTokensConfig): Promise<{
    event: Log
  }> {
    this._requireProvider()
    if (!this._provider) throw new Error()

    const { txHash } = await this.submitPassThroughTokensTransaction({
      passThroughWalletId,
      tokens,
    })
    const events = await getTransactionEvents(
      this._provider,
      txHash,
      this.eventTopics.passThroughTokens,
    )
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  async submitSetPassThroughTransaction(args: SetPassThroughConfig): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._setPassThroughTransaction(args)
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async setPassThrough(args: SetPassThroughConfig): Promise<{ event: Log }> {
    this._requireProvider()
    if (!this._provider) throw new Error()

    const { txHash } = await this.submitSetPassThroughTransaction(args)
    const events = await getTransactionEvents(
      this._provider,
      txHash,
      this.eventTopics.setPassThrough,
    )
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  async submitSetPausedTransaction(
    pauseArgs: PassThroughWalletPauseConfig,
  ): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._setPausedTransaction(pauseArgs)
    if (!this._isContractTransaction(txHash)) throw new Error('Invalid reponse')

    return { txHash }
  }

  async setPaused(pauseArgs: PassThroughWalletPauseConfig): Promise<{
    event: Log
  }> {
    this._requireProvider()
    if (!this._provider) throw new Error()

    const { txHash } = await this.submitSetPausedTransaction(pauseArgs)
    const events = await getTransactionEvents(
      this._provider,
      txHash,
      this.eventTopics.setPaused,
    )
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  async submitExecCallsTransaction(
    args: PassThroughWalletExecCallsConfig,
  ): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._execCallsTransaction(args)
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async execCalls(args: PassThroughWalletExecCallsConfig): Promise<{
    event: Log
  }> {
    this._requireProvider()
    if (!this._provider) throw new Error()

    const { txHash } = await this.submitExecCallsTransaction(args)
    const events = await getTransactionEvents(
      this._provider,
      txHash,
      this.eventTopics.execCalls,
    )
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  // Read actions
  async getPassThrough({
    passThroughWalletId,
  }: {
    passThroughWalletId: string
  }): Promise<{
    passThrough: string
  }> {
    validateAddress(passThroughWalletId)
    this._requireProvider()

    const passThroughWalletContract =
      this._getPassThroughWalletContract(passThroughWalletId)
    const passThrough = await passThroughWalletContract.read.passThrough()

    return {
      passThrough,
    }
  }
}

applyMixins(PassThroughWalletClient, [BaseClientMixin])

class PassThroughWalletGasEstimates extends PassThroughWalletTransactions {
  constructor({
    chainId,
    publicClient,
    ensProvider,
    account,
    includeEnsNames = false,
  }: SplitsClientConfig) {
    super({
      transactionType: TransactionType.GasEstimate,
      chainId,
      publicClient,
      ensProvider,
      account,
      includeEnsNames,
    })
  }

  async createPassThroughWallet({
    owner,
    paused,
    passThrough,
  }: CreatePassThroughWalletConfig): Promise<bigint> {
    const gasEstimate = await this._createPassThroughWalletTransaction({
      owner,
      paused,
      passThrough,
    })
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async passThroughTokens({
    passThroughWalletId,
    tokens,
  }: PassThroughTokensConfig): Promise<bigint> {
    const gasEstimate = await this._passThroughTokensTransaction({
      passThroughWalletId,
      tokens,
    })
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async setPassThrough(args: SetPassThroughConfig): Promise<bigint> {
    const gasEstimate = await this._setPassThroughTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async setPaused(args: PassThroughWalletPauseConfig): Promise<bigint> {
    const gasEstimate = await this._setPausedTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async execCalls(args: PassThroughWalletExecCallsConfig): Promise<bigint> {
    const gasEstimate = await this._execCallsTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }
}

applyMixins(PassThroughWalletGasEstimates, [BaseGasEstimatesMixin])

class PassThroughWalletCallData extends PassThroughWalletTransactions {
  constructor({
    chainId,
    publicClient,
    ensProvider,
    account,
    includeEnsNames = false,
  }: SplitsClientConfig) {
    super({
      transactionType: TransactionType.CallData,
      chainId,
      publicClient,
      ensProvider,
      account,
      includeEnsNames,
    })
  }

  async createPassThroughWallet({
    owner,
    paused,
    passThrough,
  }: CreatePassThroughWalletConfig): Promise<CallData> {
    const callData = await this._createPassThroughWalletTransaction({
      owner,
      paused,
      passThrough,
    })
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async passThroughTokens({
    passThroughWalletId,
    tokens,
  }: PassThroughTokensConfig): Promise<CallData> {
    const callData = await this._passThroughTokensTransaction({
      passThroughWalletId,
      tokens,
    })
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async setPassThrough(args: SetPassThroughConfig): Promise<CallData> {
    const callData = await this._setPassThroughTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async setPaused(args: PassThroughWalletPauseConfig): Promise<CallData> {
    const callData = await this._setPausedTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async execCalls(args: PassThroughWalletExecCallsConfig): Promise<CallData> {
    const callData = await this._execCallsTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }
}

import { Provider } from '@ethersproject/abstract-provider'
import { Signer } from '@ethersproject/abstract-signer'
import type { Event } from '@ethersproject/contracts'

import WaterfallClient from './waterfall'
import { WATERFALL_MODULE_FACTORY_ADDRESS } from '../constants'
import {
  InvalidArgumentError,
  InvalidConfigError,
  MissingProviderError,
  MissingSignerError,
  UnsupportedChainIdError,
} from '../errors'
import * as subgraph from '../subgraph'
import * as utils from '../utils'
import { validateAddress, validateTranches } from '../utils/validation'
import {
  TRANCHE_RECIPIENTS,
  TRANCHE_SIZES,
  GET_TOKEN_DATA,
} from '../testing/constants'
import { MockGraphqlClient } from '../testing/mocks/graphql'
import {
  MockWaterfallFactory,
  writeActions as factoryWriteActions,
} from '../testing/mocks/waterfallFactory'
import {
  MockWaterfallModule,
  writeActions as moduleWriteActions,
} from '../testing/mocks/waterfallModule'
import type { WaterfallModule } from '../types'

jest.mock('@ethersproject/contracts', () => {
  return {
    Contract: jest
      .fn()
      .mockImplementation((contractAddress, _contractInterface, provider) => {
        if (contractAddress === WATERFALL_MODULE_FACTORY_ADDRESS)
          return new MockWaterfallFactory(provider)

        return new MockWaterfallModule(provider)
      }),
  }
})

jest.mock('../utils/validation')

const getTransactionEventSpy = jest
  .spyOn(utils, 'getTransactionEvent')
  .mockImplementation(async () => {
    const event = {
      blockNumber: 12345,
      args: {
        waterfallModule: '0xwaterfall',
      },
    } as unknown as Event
    return event
  })
const getTrancheRecipientsAndSizesMock = jest
  .spyOn(utils, 'getTrancheRecipientsAndSizes')
  .mockImplementation(async () => {
    return [TRANCHE_RECIPIENTS, TRANCHE_SIZES]
  })

const getTokenDataMock = jest
  .spyOn(utils, 'getTokenData')
  .mockImplementation(async () => {
    return GET_TOKEN_DATA
  })

const mockProvider = jest.fn<Provider, unknown[]>()
const mockSigner = jest.fn<Signer, unknown[]>()

describe('Client config validation', () => {
  test('Including ens names with no provider fails', () => {
    expect(
      () => new WaterfallClient({ chainId: 1, includeEnsNames: true }),
    ).toThrow(InvalidConfigError)
  })

  test('Invalid chain id fails', () => {
    expect(() => new WaterfallClient({ chainId: 51 })).toThrow(
      UnsupportedChainIdError,
    )
  })

  test('Ethereum chain ids pass', () => {
    expect(() => new WaterfallClient({ chainId: 1 })).not.toThrow()
    expect(() => new WaterfallClient({ chainId: 5 })).not.toThrow()
  })

  test('Polygon chain ids pass', () => {
    expect(() => new WaterfallClient({ chainId: 137 })).not.toThrow()
    expect(() => new WaterfallClient({ chainId: 80001 })).not.toThrow()
  })
})

describe('Waterfall writes', () => {
  const provider = new mockProvider()
  const signer = new mockSigner()
  const waterfallClient = new WaterfallClient({
    chainId: 1,
    provider,
    signer,
  })

  beforeEach(() => {
    ;(validateTranches as jest.Mock).mockClear()
    ;(validateAddress as jest.Mock).mockClear()
    getTransactionEventSpy.mockClear()
    getTrancheRecipientsAndSizesMock.mockClear()
    // getBigNumberMock.mockClear()
  })

  describe('Create waterfall tests', () => {
    const token = '0x0'
    const tranches = [
      {
        recipient: '0xuser1',
        size: 1,
      },
      {
        recipient: '0xuser2',
      },
    ]

    beforeEach(() => {
      factoryWriteActions.createWaterfallModule.mockClear()
    })

    test('Create waterfall fails with no provider', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
      })

      await expect(
        async () =>
          await badClient.createWaterfallModule({
            token,
            tranches,
          }),
      ).rejects.toThrow(MissingProviderError)
    })

    test('Create waterfall fails with no signer', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
        provider,
      })

      await expect(
        async () =>
          await badClient.createWaterfallModule({
            token,
            tranches,
          }),
      ).rejects.toThrow(MissingSignerError)
    })

    test('Create waterfall passes', async () => {
      const { event, waterfallModuleId } =
        await waterfallClient.createWaterfallModule({
          token,
          tranches,
        })

      expect(event.blockNumber).toEqual(12345)
      expect(waterfallModuleId).toEqual('0xwaterfall')
      expect(validateAddress).toBeCalledWith(token)
      expect(validateTranches).toBeCalledWith(tranches)
      expect(getTrancheRecipientsAndSizesMock).toBeCalledWith(
        1,
        token,
        tranches,
        provider,
      )
      expect(factoryWriteActions.createWaterfallModule).toBeCalledWith(
        token,
        TRANCHE_RECIPIENTS,
        TRANCHE_SIZES,
      )
      expect(getTransactionEventSpy).toBeCalledWith(
        'create_waterfall_module_tx',
        'format_CreateWaterfallModule',
      )
    })
  })

  describe('Waterfall funds tests', () => {
    const waterfallModuleId = '0xwaterfall'

    beforeEach(() => {
      moduleWriteActions.waterfallFunds.mockClear()
    })

    test('Waterfall funds fails with no provider', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
      })

      await expect(
        async () =>
          await badClient.waterfallFunds({
            waterfallModuleId,
          }),
      ).rejects.toThrow(MissingProviderError)
    })

    test('Waterfall funds fails with no signer', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
        provider,
      })

      await expect(
        async () =>
          await badClient.waterfallFunds({
            waterfallModuleId,
          }),
      ).rejects.toThrow(MissingSignerError)
    })

    test('Waterfall funds passes', async () => {
      const { event } = await waterfallClient.waterfallFunds({
        waterfallModuleId,
      })

      expect(event.blockNumber).toEqual(12345)
      expect(validateAddress).toBeCalledWith(waterfallModuleId)
      expect(moduleWriteActions.waterfallFunds).toBeCalled()
      expect(getTransactionEventSpy).toBeCalledWith(
        'waterfall_funds_tx',
        'format_WaterfallFunds',
      )
    })
  })

  describe('Recover non waterfall funds tests', () => {
    const waterfallModuleId = '0xwaterfall'
    const token = '0xtoken'
    const recipient = '0xrecipient1'

    beforeEach(() => {
      jest
        .spyOn(waterfallClient, 'getWaterfallMetadata')
        .mockImplementationOnce(async () => {
          return {
            token: {
              address: '0xwaterfalltoken',
            },
            tranches: [
              { recipientAddress: '0xrecipient1' },
              { recipientAddress: '0xrecipient2' },
            ],
          } as WaterfallModule
        })
      moduleWriteActions.recoverNonWaterfallFunds.mockClear()
    })

    test('Recover non waterfall funds fails with no provider', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
      })

      await expect(
        async () =>
          await badClient.recoverNonWaterfallFunds({
            waterfallModuleId,
            token,
            recipient,
          }),
      ).rejects.toThrow(MissingProviderError)
    })

    test('Recover non waterfall funds fails with no signer', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
        provider,
      })

      await expect(
        async () =>
          await badClient.recoverNonWaterfallFunds({
            waterfallModuleId,
            token,
            recipient,
          }),
      ).rejects.toThrow(MissingSignerError)
    })

    test('Recover non waterfall funds fails with waterfall token', async () => {
      await expect(
        async () =>
          await waterfallClient.recoverNonWaterfallFunds({
            waterfallModuleId,
            token: '0xwaterfalltoken',
            recipient,
          }),
      ).rejects.toThrow(InvalidArgumentError)
    })

    test('Recover non waterfall funds fails with invalid recipient', async () => {
      await expect(
        async () =>
          await waterfallClient.recoverNonWaterfallFunds({
            waterfallModuleId,
            token,
            recipient: '0xbadrecipient',
          }),
      ).rejects.toThrow(InvalidArgumentError)
    })

    test('Recover non waterfall funds passes', async () => {
      const { event } = await waterfallClient.recoverNonWaterfallFunds({
        waterfallModuleId,
        token,
        recipient,
      })

      expect(event.blockNumber).toEqual(12345)
      expect(validateAddress).toBeCalledWith(waterfallModuleId)
      expect(validateAddress).toBeCalledWith(token)
      expect(validateAddress).toBeCalledWith(recipient)
      expect(moduleWriteActions.recoverNonWaterfallFunds).toBeCalledWith(
        token,
        recipient,
      )
      expect(getTransactionEventSpy).toBeCalledWith(
        'recover_non_waterfall_funds_tx',
        'format_RecoverNonWaterfallFunds',
      )
    })
  })
})

const mockGqlClient = new MockGraphqlClient()
jest.mock('graphql-request', () => {
  return {
    GraphQLClient: jest.fn().mockImplementation(() => {
      return mockGqlClient
    }),
    gql: jest.fn(),
  }
})

describe('Graphql reads', () => {
  const mockFormatWaterfall = jest
    .spyOn(subgraph, 'protectedFormatWaterfallModule')
    .mockReturnValue('formatted_waterfall_module' as unknown as WaterfallModule)
  const mockAddEnsNames = jest
    .spyOn(utils, 'addWaterfallEnsNames')
    .mockImplementation()
  const mockGqlWaterfall = {
    token: {
      id: '0xwaterfallToken',
    },
  }

  const waterfallModuleId = '0xwaterfall'
  const provider = new mockProvider()
  const waterfallClient = new WaterfallClient({
    chainId: 1,
    provider,
  })

  beforeEach(() => {
    ;(validateAddress as jest.Mock).mockClear()
    mockGqlClient.request.mockClear()
    mockFormatWaterfall.mockClear()
    mockAddEnsNames.mockClear()
  })

  describe('Get waterfall metadata tests', () => {
    beforeEach(() => {
      mockGqlClient.request.mockReturnValue({
        waterfallModule: {
          token: {
            id: '0xwaterfallToken',
          },
        },
      })
    })

    test('Get waterfall metadata fails with no provider', async () => {
      const badClient = new WaterfallClient({
        chainId: 1,
      })
      await expect(
        async () =>
          await badClient.getWaterfallMetadata({
            waterfallModuleId,
          }),
      ).rejects.toThrow(MissingProviderError)
    })

    test('Get waterfall metadata passes', async () => {
      const waterfallModule = await waterfallClient.getWaterfallMetadata({
        waterfallModuleId,
      })

      expect(validateAddress).toBeCalledWith(waterfallModuleId)
      expect(mockGqlClient.request).toBeCalledWith(
        subgraph.WATERFALL_MODULE_QUERY,
        {
          waterfallModuleId,
        },
      )
      expect(getTokenDataMock).toBeCalledWith(
        1,
        mockGqlWaterfall.token.id,
        provider,
      )
      expect(mockFormatWaterfall).toBeCalledWith(
        mockGqlWaterfall,
        GET_TOKEN_DATA.symbol,
        GET_TOKEN_DATA.decimals,
      )
      expect(waterfallModule).toEqual('formatted_waterfall_module')
      expect(mockAddEnsNames).not.toBeCalled()
    })

    test('Adds ens names', async () => {
      const provider = new mockProvider()
      const ensWaterfallClient = new WaterfallClient({
        chainId: 1,
        provider,
        includeEnsNames: true,
      })

      const waterfallModule = await ensWaterfallClient.getWaterfallMetadata({
        waterfallModuleId,
      })

      expect(validateAddress).toBeCalledWith(waterfallModuleId)
      expect(mockGqlClient.request).toBeCalledWith(
        subgraph.WATERFALL_MODULE_QUERY,
        {
          waterfallModuleId,
        },
      )
      expect(getTokenDataMock).toBeCalledWith(
        1,
        mockGqlWaterfall.token.id,
        provider,
      )
      expect(mockFormatWaterfall).toBeCalledWith(
        mockGqlWaterfall,
        GET_TOKEN_DATA.symbol,
        GET_TOKEN_DATA.decimals,
      )
      expect(waterfallModule).toEqual('formatted_waterfall_module')
      expect(mockAddEnsNames).toBeCalled()
    })
  })
})

import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import LicensingService from 'common/licensing-service'
import { buildSchema } from 'common/telemetry'
import Database from 'core/database'
import { TelemetryRepository } from 'core/repositories/telemetry'
import { TYPES } from 'core/types'
import { inject, injectable } from 'inversify'
import _ from 'lodash'
import ms from 'ms'

import { GhostService } from '..'
import { BotService } from '../bot-service'
import { JobService } from '../job-service'

import { BotHooks, getHooksLifecycle, Hook } from './hooks'
import { TelemetryStats } from './telemetry-stats'

const PARSE_CONFIG = { allowReturnOutsideFunction: true }

interface UsageParams {
  botId?: string
  lifecycle?: string
  enabled?: Boolean
}

interface Usage {
  module: string
  function: string
  count: number
}

interface ParsedFile extends UsageParams {
  fileName: string
  usages: Usage[]
}

interface SDKUsageEvent {
  actions: SDKUsage
  hooks: SDKUsage
}

interface SDKUsage {
  global: ParsedFile[]
  perBots: ParsedFile[]
}

@injectable()
export class SDKStats extends TelemetryStats {
  protected interval: number
  protected url: string
  protected lock: string

  constructor(
    @inject(TYPES.GhostService) ghostService: GhostService,
    @inject(TYPES.Database) database: Database,
    @inject(TYPES.LicensingService) licenseService: LicensingService,
    @inject(TYPES.JobService) jobService: JobService,
    @inject(TYPES.TelemetryRepository) telemetryRepo: TelemetryRepository,
    @inject(TYPES.BotService) private botService: BotService
  ) {
    super(ghostService, database, licenseService, jobService, telemetryRepo)
    this.url = process.TELEMETRY_URL
    this.lock = 'botpress:telemetry-SDK'
    this.interval = ms('1d')
  }

  protected async getStats() {
    return {
      ...buildSchema(await this.getServerStats(), 'server'),
      event_type: 'custom_roles',
      event_data: { schema: '1.0.0', SDKMethods: await this.SDKUsage() }
    }
  }

  private async SDKUsage(): Promise<SDKUsageEvent> {
    const bots = await this.botService.getBotsIds()
    return { actions: await this.getActionUsages(bots), hooks: await this.getHooksUsages() }
  }

  private async getActionUsages(bots: string[]): Promise<SDKUsage> {
    const rootFolder = 'actions'
    const globalActionsNames = await this.ghostService
      .global()
      .directoryListing('/', `${rootFolder}/*.js`)
      .map(path => path.split('/').pop() || '')

    const global = await Promise.map(globalActionsNames, this.parseFile(`/${rootFolder}`))
    const perBots = await Promise.reduce(bots, this.botActionsReducer(rootFolder), [] as ParsedFile[])

    return { global, perBots }
  }

  private botActionsReducer(rootFolder: string): (acc: any, botId: any) => Promise<ParsedFile[]> {
    return async (acc, botId) => {
      const botActionsNames = await this.ghostService.forBot(botId).directoryListing(`/${rootFolder}`, '*.js')
      const parsedFiles = await Promise.map(botActionsNames, this.parseFile(`/${rootFolder}`, { botId }))
      return [...acc, ...parsedFiles]
    }
  }

  private async getHooksUsages(): Promise<SDKUsage> {
    const hooksPayload = await getHooksLifecycle(this.botService, this.ghostService)
    const global = await this.parseHooks(hooksPayload.global.filter(hook => hook.type === 'custom'))
    const perBots = await Promise.reduce(hooksPayload.perBots, this.botHooksReducer(), [] as ParsedFile[])

    return { global, perBots }
  }

  private botHooksReducer(): (acc: any, botHooks: BotHooks) => Promise<ParsedFile[]> {
    return async (acc, botHooks: BotHooks) => {
      const { botId, hooks } = botHooks
      const parsedFiles = await this.parseHooks(
        hooks.filter(hook => hook.type === 'custom'),
        botId
      )
      return [...acc, ...parsedFiles]
    }
  }

  private async parseHooks(hooks: Hook[], botId?: string): Promise<ParsedFile[]> {
    return Promise.map(hooks, async hook => {
      const { lifecycle, enabled, path } = hook
      const usageParams = { lifecycle, enabled }

      if (botId) {
        _.set(usageParams, 'botId', botId)
      }

      return this.parseFile('/hooks', usageParams)(path!)
    })
  }

  private parseFile(rootFolder: string, usageParams?): (name: string) => Promise<ParsedFile> {
    return async (name: string) => {
      const file = await this.readFileAsString(rootFolder, name, _.get(usageParams, 'botId'))
      const functions = this.extractFunctions(parse(file, PARSE_CONFIG))
      const usage = { fileName: name.split('/').pop(), usages: this.parseFunctions(functions) }
      return { ...usage, ...usageParams }
    }
  }

  private parseFunctions(functions: string[]): Usage[] {
    const sdkFunctions = _.countBy(functions.filter(method => method.split('.')[0] === 'bp'))
    return _.map(sdkFunctions, (count, fn) => {
      const [, module, functionName] = fn.split('.')
      return { module, function: functionName, count }
    })
  }

  private extractFunctions(ast): string[] {
    const functions: string[] = []

    const findCallee = function(node) {
      if (node.type === 'MemberExpression') {
        return `${findCallee(node.object)}.${node.property.name}`
      } else {
        return node.name // breaks recursion
      }
    }

    const enter = function(path) {
      if (path.node.type === 'CallExpression') {
        const callee = findCallee(path.node.callee)
        functions.push(callee)
      }
    }

    traverse(ast, { enter })

    return functions
  }

  private async readFileAsString(rootFolder: string, fileName: string, botId?: string): Promise<string> {
    try {
      if (botId) {
        return await this.ghostService.forBot(botId).readFileAsString(rootFolder, fileName)
      } else {
        return await this.ghostService.global().readFileAsString(rootFolder, fileName)
      }
    } catch (error) {
      return ''
    }
  }
}

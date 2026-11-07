import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  TOOLKIT_CONFIGURATION_METHOD,
  type ConfigurationRequest,
  type ToolkitAuthority
} from './toolkit-authority'

type Browser = {
  snapshot(environment: string): Promise<{
    defaultFolder: string
    remoteLocation: { source: string; directory: string }
  }>
  browse(
    environment: string,
    options: {
      directory?: string
      showHidden?: boolean
      query?: string
      offset?: number
    }
  ): Promise<unknown>
  remember(environment: string, input: { folder?: string; source?: string }): Promise<void>
}

export type ToolkitRuntime = {
  platform: string
  cli: string
  ssh: string
  keygen: string
  home: string
  userDataPath: string
  loadSdk: () => unknown
  childEnv: Record<string, string>
  development?: boolean
  endpointTrustFile?: string
}

export function createToolkitDownloadBrowser(
  authority: ToolkitAuthority,
  root: string,
  override?: ToolkitRuntime
) {
  const context = authority.openContext()
  const load = createRequire(join(root, 'manifest.json'))
  const runtime = override ?? {
    platform: 'darwin',
    cli: join(process.resourcesPath, 'bin/orca'),
    ssh: '/usr/bin/ssh',
    keygen: '/usr/bin/ssh-keygen',
    home: app.getPath('home'),
    userDataPath: app.getPath('userData'),
    loadSdk: () => load(join(process.resourcesPath, 'app.asar.unpacked/out/cli/runtime-client.js')),
    childEnv: {
      PATH: '/usr/bin:/bin',
      HOME: app.getPath('home'),
      ORCA_USER_DATA_PATH: app.getPath('userData')
    }
  }
  const request = async (input: ConfigurationRequest) => {
    if (input.namespace !== 'downloads-preferences' || !['read', 'patch'].includes(input.op)) {
      throw new Error('Invalid download preference operation')
    }
    const reply = await authority.call(
      context,
      TOOLKIT_CONFIGURATION_METHOD,
      { version: 1, request: input },
      async () => true
    )
    if (!reply.ok || !reply.result) {
      throw new Error(reply.error ?? 'Download preference result unknown; retry after reload')
    }
    return reply.result
  }
  const browser: Browser = load('./modules/downloads/host-browser.cjs').create({
    runtime,
    request,
    dataDir: join(runtime.home, 'Library/Application Support/OrcaTools')
  })
  return { browser, runtime, close: () => authority.revoke(context) }
}

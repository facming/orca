import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadToolkitAuthority } from './toolkit-bundle'
import type { ConfigurationRequest } from './toolkit-authority'
import { maintenanceState } from './toolkit-maintenance'
import { TOOLKIT_CONFIGURATION_METHOD } from './toolkit-authority'
import { createMaintenanceApproval } from './toolkit-maintenance-approval'
import { createToolkitPanelContext } from './toolkit-panel-context'

let window: BrowserWindow | undefined
let opening = false
const channel = 'toolkit:configuration:v1'

export async function openToolkitConfiguration(): Promise<void> {
  if (
    process.platform !== 'darwin' ||
    process.env.ORCA_BACKGROUND_LAUNCH === '1' ||
    window ||
    opening
  ) {
    return
  }
  opening = true
  try {
    if (!app.isPackaged) {
      throw new Error('RELEASE BLOCKED: a sealed packaged Host is required')
    }
    const { authority, root } = await loadToolkitAuthority(process.resourcesPath)
    let inventoryContext: ReturnType<typeof authority.openContext> | undefined
    const inspect = async () => {
      const reply = await authority.call(
        inventoryContext,
        TOOLKIT_CONFIGURATION_METHOD,
        { version: 1, request: { op: 'status' } },
        async () => true
      )
      if (!reply.ok) {
        throw new Error(reply.error)
      }
      return maintenanceState(
        reply.result,
        join(app.getPath('home'), 'Library/Application Support/OrcaTools/downloads/jobs')
      )
    }
    const panelURL = pathToFileURL(join(root, 'panel.html')).href
    const panel = new BrowserWindow({
      title: 'Toolkit configuration',
      show: false,
      webPreferences: {
        preload: join(root, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
        partition: 'toolkit-configuration'
      }
    })
    window = panel
    let context: ReturnType<typeof createToolkitPanelContext> | undefined
    let preview: Record<string, unknown> | undefined
    const revoke = (): void => {
      authority.revokeAll()
      context = undefined
      inventoryContext = undefined
      preview = undefined
    }
    const active = (): boolean =>
      !panel.isDestroyed() &&
      !panel.webContents.isDestroyed() &&
      panel.webContents.getURL() === panelURL
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    panel.webContents.on('will-navigate', (event) => {
      event.preventDefault()
      revoke()
    })
    panel.webContents.on('will-attach-webview', (event) => event.preventDefault())
    panel.webContents.on('did-start-navigation', revoke)
    panel.webContents.on('render-process-gone', revoke)
    panel.webContents.once('did-finish-load', () => {
      if (active()) {
        inventoryContext = authority.openContext(true)
        context = createToolkitPanelContext(
          authority,
          panel.webContents,
          panelURL,
          createMaintenanceApproval(
            inspect,
            (request) => approve(panel, request),
            (request) =>
              !!preview &&
              request.preview_id === preview.preview_id &&
              JSON.stringify(request.hashes) === JSON.stringify(preview.hashes)
          )
        )
      }
    })
    panel.once('closed', () => {
      revoke()
      ipcMain.removeHandler(channel)
      app.removeListener('before-quit', revoke)
      window = undefined
    })
    app.once('before-quit', revoke)
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (
        !context ||
        !active() ||
        event.sender !== panel.webContents ||
        event.senderFrame !== panel.webContents.mainFrame ||
        event.senderFrame.url !== panelURL
      ) {
        throw new Error('Unauthorized Toolkit source')
      }
      const reply = await context.call(event, input)
      if (reply.ok && typeof reply.result?.preview_id === 'string') {
        preview = reply.result
      }
      if (!reply.ok) {
        throw new Error(reply.error)
      }
      if (reply.result?.state && !reply.result.raw_json) {
        return inspect()
      }
      return reply.result
    })
    try {
      await panel.loadURL(panelURL)
    } catch (error) {
      panel.destroy()
      throw error
    }
    // This window is opened only by a user menu action; automated/background launches return above.
    panel.show()
  } catch {
    await dialog.showMessageBox({
      type: 'warning',
      message: 'Toolkit configuration is unavailable',
      detail:
        'RELEASE BLOCKED: the signed Host runtime, sealed Toolkit bundle and isolated service must pass enrollment first.'
    })
  } finally {
    opening = false
  }
}

async function approve(panel: BrowserWindow, request: ConfigurationRequest): Promise<boolean> {
  if (['read', 'status', 'preview'].includes(request.op)) {
    return true
  }
  const result = await dialog.showMessageBox(panel, {
    type: 'question',
    message: `Allow Toolkit configuration ${request.op}?`,
    detail:
      request.op === 'import'
        ? `Confirm preview ${String(request.preview_id)}. Both selected documents will be imported.`
        : request.op === 'restore'
          ? `Restore ${String(request.backup_id)}. Both documents will be replaced; other editors must reload.`
          : 'Apply this configuration operation through the Orca main process.',
    buttons: ['Cancel', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return result.response === 1
}

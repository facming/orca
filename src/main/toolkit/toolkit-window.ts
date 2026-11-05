import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { pathToFileURL } from 'node:url'
import { loadToolkitAuthority } from './toolkit-bundle'
import type { ConfigurationRequest } from './toolkit-authority'
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
        context = createToolkitPanelContext(
          authority,
          panel.webContents,
          panelURL,
          async (request) => {
            if (
              request.op === 'import' &&
              (!preview ||
                request.preview_id !== preview.preview_id ||
                JSON.stringify(request.hashes) !== JSON.stringify(preview.hashes))
            ) {
              return false
            }
            return approve(panel, request)
          }
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
  // Legacy task ownership has not moved into main; do not bypass its target-change guard.
  if (['import', 'restore'].includes(request.op)) {
    return false
  }
  if (request.op === 'patch' && request.namespace === 'settings') {
    const patch = z.array(z.object({ path: z.array(z.string()) })).parse(request.patch)
    if (
      patch.some(
        ({ path }) =>
          path[0] === 'downloads' &&
          (path.length === 1 || ['environment', 'sshHost', 'sshUser', 'sshPort'].includes(path[1]))
      )
    ) {
      return false
    }
  }
  if (['read', 'status', 'preview'].includes(request.op)) {
    return true
  }
  const result = await dialog.showMessageBox(panel, {
    type: 'question',
    message: `Allow Toolkit configuration ${request.op}?`,
    buttons: ['Cancel', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return result.response === 1
}

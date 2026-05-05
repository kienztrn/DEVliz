import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { getDb } from './db'
import { startMailServer } from './services/mail-server'

function attachDevShortcuts(window: BrowserWindow): void {
  const { webContents } = window
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrlOrMeta = input.control || input.meta

    if (input.code === 'F12') {
      if (webContents.isDevToolsOpened()) webContents.closeDevTools()
      else webContents.openDevTools({ mode: 'undocked' })
      event.preventDefault()
      return
    }

    if (ctrlOrMeta && input.shift && input.code === 'KeyI') {
      if (webContents.isDevToolsOpened()) webContents.closeDevTools()
      else webContents.openDevTools({ mode: 'undocked' })
      event.preventDefault()
      return
    }

    if (ctrlOrMeta && input.code === 'KeyR') {
      webContents.reloadIgnoringCache()
      event.preventDefault()
      return
    }

    if (input.code === 'F5') {
      webContents.reloadIgnoringCache()
      event.preventDefault()
      return
    }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.kienztrn.multibrowsermanager')

  app.on('browser-window-created', (_e, window) => {
    attachDevShortcuts(window)
  })

  // Initialize DB, mail report server, and IPC
  getDb()
  void startMailServer().catch(() => {
    // best effort; mail badge feature will be disabled
  })
  registerIpcHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

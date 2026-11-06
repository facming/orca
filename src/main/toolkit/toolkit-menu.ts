import { openToolkitConfiguration } from './toolkit-window'

export function toolkitMenu(): Electron.MenuItemConstructorOptions {
  return {
    label: 'Orca Toolkit',
    submenu: [
      {
        label: 'Project workbench…',
        click: () => {
          void openToolkitConfiguration('host-workbench')
        }
      },
      {
        label: 'Accounts…',
        click: () => {
          void openToolkitConfiguration('host-accounts')
        }
      },
      {
        label: 'Downloads…',
        accelerator: 'Ctrl+Alt+D',
        click: () => {
          void openToolkitConfiguration('host-downloads')
        }
      },
      {
        label: 'GPU & native tools…',
        accelerator: 'Ctrl+Alt+G',
        click: () => {
          void openToolkitConfiguration('host-gpu')
        }
      },
      {
        label: 'Settings & maintenance…',
        accelerator: 'Ctrl+Alt+T',
        click: () => {
          void openToolkitConfiguration()
        }
      }
    ]
  }
}

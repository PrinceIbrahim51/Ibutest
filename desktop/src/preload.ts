/**
 * Sandboxed preload: exposes a tiny, explicit API to the page via contextBridge.
 * No Node.js or Electron objects are ever handed to web content; the main process
 * additionally checks which page (origin) sent each IPC message.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ibutestDesktop', {
  isDesktop: true,
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  connectRemote: (url: string) => ipcRenderer.invoke('desktop:connect-remote', String(url)),
  startLocal: (options?: { anthropicApiKey?: string }) =>
    ipcRenderer.invoke('desktop:start-local', { anthropicApiKey: String(options?.anthropicApiKey ?? '') }),
  openServerSettings: () => ipcRenderer.invoke('desktop:open-launcher'),
});

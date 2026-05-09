const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("locationApp", {
  setupChecks: () => ipcRenderer.invoke("app:setupChecks"),
  status: () => ipcRenderer.invoke("app:status"),
  runCommand: (command) => ipcRenderer.invoke("app:runCommand", command),
  loadPresets: () => ipcRenderer.invoke("app:loadPresets"),
  savePresets: (payload) => ipcRenderer.invoke("app:savePresets", payload),
  readLogs: () => ipcRenderer.invoke("app:readLogs"),
});

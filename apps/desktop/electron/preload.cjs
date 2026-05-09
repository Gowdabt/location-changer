const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("locationApp", {
  setupChecks: (platform) => ipcRenderer.invoke("app:setupChecks", platform),
  status: (platform) => ipcRenderer.invoke("app:status", platform),
  environment: () => ipcRenderer.invoke("app:environment"),
  runCommand: (command) => ipcRenderer.invoke("app:runCommand", command),
  loadPresets: () => ipcRenderer.invoke("app:loadPresets"),
  savePresets: (payload) => ipcRenderer.invoke("app:savePresets", payload),
  readLogs: () => ipcRenderer.invoke("app:readLogs"),
});

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("locationApp", {
  setupChecks: (platform) => ipcRenderer.invoke("app:setupChecks", platform),
  status: (platform) => ipcRenderer.invoke("app:status", platform),
  environment: () => ipcRenderer.invoke("app:environment"),
  health: () => ipcRenderer.invoke("app:health"),
  repairAction: (action) => ipcRenderer.invoke("app:repairAction", action),
  runCommand: (command) => ipcRenderer.invoke("app:runCommand", command),
  loadPresets: () => ipcRenderer.invoke("app:loadPresets"),
  savePresets: (payload) => ipcRenderer.invoke("app:savePresets", payload),
  exportPresets: (payload) => ipcRenderer.invoke("app:exportPresets", payload),
  importPresets: () => ipcRenderer.invoke("app:importPresets"),
  loadSettings: () => ipcRenderer.invoke("app:loadSettings"),
  saveSettings: (payload) => ipcRenderer.invoke("app:saveSettings", payload),
  readLogs: () => ipcRenderer.invoke("app:readLogs"),
  exportDiagnostics: () => ipcRenderer.invoke("app:exportDiagnostics"),
  // Remote Control methods
  getRemoteControlStatus: () => ipcRenderer.invoke("app:getRemoteControlStatus"),
  setRemoteControlEnabled: (enabled) => ipcRenderer.invoke("app:setRemoteControlEnabled", enabled),
  setWiFiModeEnabled: (enabled) => ipcRenderer.invoke("app:setWiFiModeEnabled", enabled),
  generateQRCode: (url) => ipcRenderer.invoke("app:generateQRCode", url),
  pairWiFiDevice: () => ipcRenderer.invoke("app:pairWiFiDevice"),
  // Event listener for main->renderer notifications
  onEvent: (channel, callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

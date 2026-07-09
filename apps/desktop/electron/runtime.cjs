const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(command, args, options = {}) {
  const {
    timeoutMs = 8000,
    retries = 0,
    retryDelayMs = 400,
    transientMatcher,
    successGuard,
  } = options;
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const result = await execFileAsync(command, args, { timeout: timeoutMs });
      if (successGuard) {
        successGuard(result);
      }
      return result;
    } catch (error) {
      lastError = error;
      const retryable =
        typeof transientMatcher === "function" ? transientMatcher(error) : false;
      if (!retryable || attempt === retries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
    attempt += 1;
  }
  throw lastError;
}

function getCombinedOutput(resultOrError) {
  const stdout = resultOrError?.stdout || "";
  const stderr = resultOrError?.stderr || "";
  return `${stdout}\n${stderr}`;
}

function assertNoTunneldFailure(resultOrError) {
  const combined = getCombinedOutput(resultOrError);
  if (combined.includes("Unable to connect to Tunneld")) {
    throw new Error(
      "iOS developer tunnel is required. Start it with: sudo python3 -m pymobiledevice3 remote tunneld",
    );
  }
}

function isTransientError(error) {
  const combined = getCombinedOutput(error);
  return (
    combined.includes("InvalidServiceError") ||
    combined.includes("Broken pipe") ||
    combined.includes("timed out") ||
    combined.includes("temporarily unavailable") ||
    error?.code === 120 ||
    error?.killed === true
  );
}

function isTunnelConnectionError(output) {
  return (
    output.includes("Connect call failed") ||
    output.includes("OSError") ||
    output.includes("ConnectionRefusedError") ||
    output.includes("NoDeviceConnectedError") ||
    output.includes("errno 64534")
  );
}

module.exports = {
  runCommand,
  getCombinedOutput,
  assertNoTunneldFailure,
  isTransientError,
  isTunnelConnectionError,
};

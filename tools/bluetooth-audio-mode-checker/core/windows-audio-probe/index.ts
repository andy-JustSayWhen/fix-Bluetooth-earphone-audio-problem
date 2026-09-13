import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AudioProbeSnapshot,
  RawAudioDevice,
  WindowsEndpointFormat,
} from "../../shared/audio-device-types/index.ts";

export type WindowsEndpointFacts = {
  flow: "eRender" | "eCapture";
  id: string;
  name: string;
  rate: number;
  channels: number;
  bits: number;
  configuredRate?: number;
  configuredStatus?: string;
  supportedRates?: number[];
  supportedStatus?: string;
  transport: string;
  role: "handsfree" | "a2dp" | null;
  bluetoothAddress: string | null;
  canonicalId: string | null;
  containerId?: string | null;
  physicalName: string | null;
  manufacturer: string | null;
  pnpFound: boolean;
  sessionsKnown?: boolean;
  sessions?: Array<{ pid: number; name: string; id: string }>;
};

export type WindowsProbeResult = {
  voiceLinks?: Array<{address: string; timestamp: string}>;
  endpoints: WindowsEndpointFacts[];
  defaults: {
    renderConsole: EndpointSummary | null;
    renderComms: EndpointSummary | null;
    renderMultimedia?: EndpointSummary | null;
    captureMultimedia?: EndpointSummary | null;
    captureComms?: EndpointSummary | null;
    captureConsole: EndpointSummary | null;
  };
};

export type EndpointSummary = {
  id: string;
  name: string | null;
  rate: number;
  channels: number;
  bits: number;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const csPath = join(moduleDirectory, "probe-audio-endpoints.cs");
const ps1Path = join(moduleDirectory, "full-probe.ps1");

const roleSuffixPattern = /\s*(?:Stereo|Hands[- ]?Free(?:\s+(?:AG\s+Audio|Call|Audio))?|立体声|免提)\s*$/i;

export function stripBluetoothRoleSuffix(name: string): string {
  const inner = name.match(/[(（]([^()（）]+)[)）]\s*$/);
  const base = (inner ? inner[1] : name).replace(roleSuffixPattern, "").trim();
  return base.length > 0 ? base : name.trim();
}

function runProbeScriptSync(): WindowsProbeResult {
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1Path, "-CsPath", csPath],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 15_000 },
  );
  return JSON.parse(output.trim()) as WindowsProbeResult;
}

export async function readAudioEndpointFactsAsync(): Promise<WindowsProbeResult> {
  const result = await getWindowsProbe();
  rememberProbeResult(result);
  return result;
}

let lastProbeResult: WindowsProbeResult | null = null;
const physicalNameByEndpointId = new Map<string, string>();

function rememberProbeResult(result: WindowsProbeResult): void {
  lastProbeResult = result;
  const devices = aggregatePhysicalDevices(result);
  const groups = groupEndpointsByPhysicalDevice(result);
  const endpointNames = groups.flatMap((group, index) => group.endpoints.map(endpoint => [endpoint.id, devices[index].name] as const));
  physicalNameByEndpointId.clear();
  for (const [endpointId, deviceName] of endpointNames) {
    physicalNameByEndpointId.set(endpointId, deviceName);
  }
  void devices;
}

export function resolvePhysicalDeviceName(endpointId: string): string | null {
  return physicalNameByEndpointId.get(endpointId) ?? null;
}

export function formatBluetoothAddress(raw12: string): string {
  const digits = raw12.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (digits.length !== 12) return digits;
  return digits.replace(/(..)(..)(..)(..)(..)(..)/, "$1:$2:$3:$4:$5:$6");
}

type EndpointGroup = {
  key: string;
  transport: string;
  endpoints: WindowsEndpointFacts[];
  endpointIds: string[];
  bluetoothAddress: string | null;
  physicalName: string | null;
  manufacturer: string | null;
};

export function groupEndpointsByPhysicalDevice(result: WindowsProbeResult): EndpointGroup[] {
  const groups = new Map<string, EndpointGroup>();
  for (const endpoint of result.endpoints) {
    // 蓝牙设备的免提与立体声端点必须合并成同一物理设备；其余设备按端点拆分，保证路由名称正确。
    const container = endpoint.containerId?.replace(/[{}]/g, "").toUpperCase();
    const validContainer = container && /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(container)
      && !["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-FFFF-FFFFFFFFFFFF"].includes(container);
    const key = endpoint.transport.startsWith("bluetooth")
      ? (validContainer ? `container:${container}` : endpoint.bluetoothAddress ? formatBluetoothAddress(endpoint.bluetoothAddress) : endpoint.canonicalId ?? endpoint.id)
      : endpoint.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        transport: endpoint.transport,
        endpoints: [],
        endpointIds: [],
        bluetoothAddress: endpoint.bluetoothAddress,
        physicalName: endpoint.physicalName,
        manufacturer: endpoint.manufacturer,
      };
      groups.set(key, group);
    }
    group.endpoints.push(endpoint);
    group.endpointIds.push(endpoint.id);
    if (!group.bluetoothAddress && endpoint.bluetoothAddress) group.bluetoothAddress = endpoint.bluetoothAddress;
    if (!group.physicalName && endpoint.physicalName) group.physicalName = endpoint.physicalName;
    if (!group.manufacturer && endpoint.manufacturer) group.manufacturer = endpoint.manufacturer;
  }
  return [...groups.values()];
}

function selectEndpoint(endpoints: WindowsEndpointFacts[], defaultId: string | null | undefined): WindowsEndpointFacts | null {
  if (endpoints.length === 0) return null;
  if (defaultId) {
    const hostingDefault = endpoints.find((endpoint) => endpoint.id === defaultId);
    if (hostingDefault) return hostingDefault;
  }
  return [...endpoints].sort((left, right) => right.rate - left.rate || right.channels - left.channels)[0];
}

function endpointFormat(endpoint: WindowsEndpointFacts | null): WindowsEndpointFormat {
  const rate = endpoint?.configuredRate;
  return {
    configuredRate: endpoint?.configuredStatus === "ok" && Number.isFinite(rate) && rate! > 0 ? rate! : null,
    configuredStatus: endpoint?.configuredStatus === "ok" ? "ok" : endpoint?.configuredStatus?.startsWith("error:") ? "error" : "unavailable",
    supportedRates: [...new Set((endpoint?.supportedRates ?? []).filter(rate => Number.isFinite(rate) && rate > 0))].sort((a, b) => a - b),
    supportedStatus: endpoint?.supportedStatus === "ok" ? "ok" : endpoint?.supportedStatus === "partial" ? "partial" : "unavailable",
  };
}

export function aggregatePhysicalDevices(result: WindowsProbeResult): RawAudioDevice[] {
  const groups = groupEndpointsByPhysicalDevice(result);
  const devices: RawAudioDevice[] = [];
  let sequence = 0;
  for (const group of groups) {
    const isBluetooth = group.transport.startsWith("bluetooth");
    const outputEndpoints = group.endpoints.filter((endpoint) => endpoint.flow === "eRender");
    const inputEndpoints = group.endpoints.filter((endpoint) => endpoint.flow === "eCapture");
    const renderConsole = result.defaults.renderConsole;
    const renderComms = result.defaults.renderComms;
    const captureConsole = result.defaults.captureConsole;

    const selectedOutput = selectEndpoint(outputEndpoints, renderConsole?.id);
    const selectedInput = selectEndpoint(inputEndpoints, captureConsole?.id);
    const hostsDefaultOutput = selectedOutput !== null && renderConsole !== null && selectedOutput.id === renderConsole.id;
    const hostsDefaultInput = selectedInput !== null && captureConsole !== null && selectedInput.id === captureConsole.id;

    let name = isBluetooth
      ? (group.physicalName?.trim() || stripBluetoothRoleSuffix(
          (selectedOutput ?? selectedInput ?? group.endpoints[0]).name ?? "未命名蓝牙设备",
        ) || "未命名蓝牙设备")
      : (selectedOutput ?? selectedInput ?? group.endpoints[0]).name ?? "未命名设备";

    if (groups.some(other => other.key !== group.key && (other.physicalName || other.endpoints[0].name) === (group.physicalName || group.endpoints[0].name))) name += ` [${group.key}]`;
    devices.push({
      windowsEvidence: {
        voiceLink: result.voiceLinks?.filter(link => group.bluetoothAddress &&
          link.address.replace(/[^a-f0-9]/gi, "").toUpperCase() === group.bluetoothAddress.replace(/[^a-f0-9]/gi, "").toUpperCase() &&
          Number.isFinite(Date.parse(link.timestamp)))
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0],
        transport: group.transport,
        activeCapture: inputEndpoints.some(e => (e.sessions?.length ?? 0) > 0),
        activeHandsfreeOutput: outputEndpoints.some(e => e.role === "handsfree" && (e.sessions?.length ?? 0) > 0),
        activeOutput: outputEndpoints.some(e => (e.sessions?.length ?? 0) > 0),
        sessionsKnown: group.endpoints.every(e => e.sessionsKnown === true),
        splitStereoActive: outputEndpoints.some(e => e.role === "handsfree") && outputEndpoints.some(e => e.role === "a2dp" && (e.sessions?.length ?? 0) > 0),
        mixRate: selectedOutput?.rate || null,
        inputFormat: endpointFormat(selectedInput),
        outputFormat: endpointFormat(selectedOutput),
      },
      id: ++sequence,
      name,
      uid: group.key,
      manufacturer: group.manufacturer ?? "",
      transport: group.transport,
      sampleRateInput: selectedInput?.rate > 0 ? selectedInput.rate : null,
      sampleRateOutput: selectedOutput?.rate > 0 ? selectedOutput.rate : null,
      availableSampleRateRangesInput: [],
      nominalSampleRateInput: null,
      actualSampleRateInput: null,
      availableSampleRateRangesOutput: [],
      nominalSampleRateOutput: null,
      actualSampleRateOutput: null,
      maxSupportedOutputRate: null,
      inputChannels: selectedInput?.channels ?? 0,
      outputChannels: selectedOutput?.channels ?? 0,
      isRunning: group.endpoints.some(endpoint => (endpoint.sessions?.length ?? 0) > 0),
      isDefaultInput: hostsDefaultInput,
      isDefaultOutput: hostsDefaultOutput,
      isDefaultSystemOutput: outputEndpoints.some((endpoint) => renderComms !== null && endpoint.id === renderComms.id),
      bluetoothAddress: group.bluetoothAddress ? formatBluetoothAddress(group.bluetoothAddress) : undefined,
      supportedBluetoothServices: isBluetooth
        ? [...new Set(group.endpoints.map((endpoint) => endpoint.role).filter((role) => role !== null))]
        : undefined,
    });
  }
  return devices;
}

export function readAudioDevices(): AudioProbeSnapshot {
  const result = lastProbeResult ?? runProbeScriptSync();
  rememberProbeResult(result);
  return {
    timestamp: new Date().toISOString(),
    devices: aggregatePhysicalDevices(result),
  };
}

export async function readAudioDevicesAsync(): Promise<AudioProbeSnapshot> {
  const result = await getWindowsProbe();
  rememberProbeResult(result);
  return {
    timestamp: new Date().toISOString(),
    devices: aggregatePhysicalDevices(result),
  };
}

let worker: ReturnType<typeof spawn> | null = null;
let updatedAt = 0;
let workerError = "正在读取 Windows 声音设备";
const listeners = new Set<(result: WindowsProbeResult) => void>();

export function startWindowsProbe(onResult?: (result: WindowsProbeResult) => void): () => void {
  if (onResult) listeners.add(onResult);
  if (!worker) {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1Path, "-CsPath", csPath, "-Watch", "-ParentPid", String(process.pid)], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    worker = child;
    child.unref();
    (child.stdout as unknown as { unref?: () => void }).unref?.();
    (child.stderr as unknown as { unref?: () => void }).unref?.();
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 10 * 1024 * 1024) { workerError = "声音探测结果超出大小限制"; child.kill(); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const result = JSON.parse(line) as WindowsProbeResult;
          if (!Array.isArray(result.endpoints) || !result.defaults) throw new Error("声音探测结果格式不正确");
          rememberProbeResult(result); updatedAt = Date.now();
          for (const listener of listeners) listener(result);
        } catch (error) { workerError = String(error); }
      }
    });
    child.stderr.on("data", (chunk: string) => { workerError = chunk.slice(-2_000); });
    child.once("error", error => { workerError = error.message; });
    child.once("close", () => { stopWorkerTrace(child); if (worker === child) { worker = null; updatedAt = 0; } });
  }
  return () => { if (onResult) listeners.delete(onResult); };
}

process.once("exit", stopWindowsProbe);

const cleanedTraceWorkers = new WeakSet<object>();
function stopWorkerTrace(child: ReturnType<typeof spawn>): void {
  if (process.platform !== "win32" || !child.pid || cleanedTraceWorkers.has(child)) return;
  cleanedTraceWorkers.add(child);
  try {
    // The helper may be killed while its logman child is still creating the session.
    const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid} AND Name = 'logman.exe'" | ForEach-Object { try { [Diagnostics.Process]::GetProcessById($_.ProcessId).WaitForExit(2000) | Out-Null } catch {} }; & logman.exe stop BluetoothAudioMode-${child.pid} -ets`;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide: true, stdio: "ignore", timeout: 5000});
  } catch { /* Session may already have been stopped by the helper. */ }
}
export function stopWindowsProbe(): void {
  const child = worker; worker = null; updatedAt = 0; lastProbeResult = null;
  if (child) { child.kill(); stopWorkerTrace(child); }
}

export async function getWindowsProbe(after = 0): Promise<WindowsProbeResult> {
  startWindowsProbe();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (lastProbeResult && updatedAt > after && Date.now() - updatedAt < 3_000) return lastProbeResult;
    if (!worker) throw new Error(workerError);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  stopWindowsProbe();
  throw new Error(`Windows 声音探测超时：${workerError}`);
}

export function endpointDeviceName(endpoint: WindowsEndpointFacts, result: WindowsProbeResult): string {
  const groupIndex = groupEndpointsByPhysicalDevice(result).findIndex(group => group.endpointIds.includes(endpoint.id));
  return aggregatePhysicalDevices(result)[groupIndex]?.name ?? endpoint.name;
}

export async function readWindowsMicrophoneUsers() {
  const result = await getWindowsProbe();
  return result.endpoints.filter(e => e.flow === "eCapture").flatMap(endpoint =>
    (endpoint.sessions ?? []).filter(session => session.pid > 0).map(session => {
      const name = endpointDeviceName(endpoint, result);
      return {
        pid: session.pid, name: session.name, bundleId: "", devices: [name],
        inputActivityKind: "已确认实体麦克风占用" as const,
        physicalDeviceNames: [name], confirmedDeviceNames: [name],
        occupancyEvidenceKinds: endpoint.transport.startsWith("bluetooth") ? ["physical-bluetooth-microphone" as const] : [],
      };
    }));
}

export function windowsSpeakerUsers(result: WindowsProbeResult) {
  return result.endpoints.filter(e => e.flow === "eRender" && e.bluetoothAddress).flatMap(endpoint =>
    (endpoint.sessions ?? []).filter(session => session.pid > 0).map(session => ({
      sessionId: session.id, pid: session.pid, name: session.name, deviceUid: endpoint.id,
      bluetoothAddress: formatBluetoothAddress(endpoint.bluetoothAddress!), observedAt: new Date(updatedAt).toISOString(),
    })));
}

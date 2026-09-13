import { execFile, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AudioProbeSnapshot,
  RawAudioDevice,
  SampleRateRange,
} from "../../shared/audio-device-types/index.ts";

export type WindowsEndpointFacts = {
  flow: "eRender" | "eCapture";
  id: string;
  name: string;
  rate: number;
  channels: number;
  bits: number;
  transport: string;
  role: "handsfree" | "a2dp" | null;
  bluetoothAddress: string | null;
  canonicalId: string | null;
  physicalName: string | null;
  manufacturer: string | null;
  pnpFound: boolean;
};

export type WindowsProbeResult = {
  endpoints: WindowsEndpointFacts[];
  defaults: {
    renderConsole: EndpointSummary | null;
    renderComms: EndpointSummary | null;
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
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true },
  );
  return JSON.parse(output.trim()) as WindowsProbeResult;
}

function runProbeScriptAsync(): Promise<WindowsProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1Path, "-CsPath", csPath],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(String(stdout).trim()) as WindowsProbeResult);
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
        }
      },
    );
  });
}

export async function readAudioEndpointFactsAsync(): Promise<WindowsProbeResult> {
  const result = await runProbeScriptAsync();
  rememberProbeResult(result);
  return result;
}

let lastProbeResult: WindowsProbeResult | null = null;
const physicalNameByEndpointId = new Map<string, string>();

function rememberProbeResult(result: WindowsProbeResult): void {
  lastProbeResult = result;
  const { devices, endpointNames } = buildPhysicalDevices(result);
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
    // 蓝牙设备的免提与立体声端点必须合并成同一物理设备；其余设备按方向拆分，保证路由名称正确。
    const key = endpoint.transport === "bluetooth"
      ? (endpoint.canonicalId ?? endpoint.id)
      : `${endpoint.canonicalId ?? endpoint.id}:${endpoint.flow}`;
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

function mergeRanges(endpoints: WindowsEndpointFacts[]): SampleRateRange[] {
  const ranges = new Map<number, SampleRateRange>();
  for (const endpoint of endpoints) {
    if (endpoint.rate > 0) ranges.set(endpoint.rate, { minimum: endpoint.rate, maximum: endpoint.rate });
  }
  return [...ranges.values()].sort((left, right) => left.maximum - right.maximum);
}

function selectEndpoint(endpoints: WindowsEndpointFacts[], defaultId: string | null | undefined): WindowsEndpointFacts | null {
  if (endpoints.length === 0) return null;
  if (defaultId) {
    const hostingDefault = endpoints.find((endpoint) => endpoint.id === defaultId);
    if (hostingDefault) return hostingDefault;
  }
  return [...endpoints].sort((left, right) => right.rate - left.rate || right.channels - left.channels)[0];
}

export function aggregatePhysicalDevices(result: WindowsProbeResult): RawAudioDevice[] {
  const groups = groupEndpointsByPhysicalDevice(result);
  const devices: RawAudioDevice[] = [];
  let sequence = 0;
  for (const group of groups) {
    const isBluetooth = group.transport === "bluetooth";
    const outputEndpoints = group.endpoints.filter((endpoint) => endpoint.flow === "eRender");
    const inputEndpoints = group.endpoints.filter((endpoint) => endpoint.flow === "eCapture");
    const renderConsole = result.defaults.renderConsole;
    const renderComms = result.defaults.renderComms;
    const captureConsole = result.defaults.captureConsole;

    const selectedOutput = selectEndpoint(outputEndpoints, renderConsole?.id);
    const selectedInput = selectEndpoint(inputEndpoints, captureConsole?.id);
    const hostsDefaultOutput = selectedOutput !== null && renderConsole !== null && selectedOutput.id === renderConsole.id;
    const hostsDefaultInput = selectedInput !== null && captureConsole !== null && selectedInput.id === captureConsole.id;

    const name = isBluetooth
      ? (group.physicalName?.trim() || stripBluetoothRoleSuffix(
          (selectedOutput ?? selectedInput ?? group.endpoints[0]).name ?? "未命名蓝牙设备",
        ) || "未命名蓝牙设备")
      : (selectedOutput ?? selectedInput ?? group.endpoints[0]).name ?? "未命名设备";

    devices.push({
      id: ++sequence,
      name,
      uid: group.key,
      manufacturer: group.manufacturer ?? "",
      transport: group.transport,
      sampleRateInput: selectedInput?.rate > 0 ? selectedInput.rate : null,
      sampleRateOutput: selectedOutput?.rate > 0 ? selectedOutput.rate : null,
      availableSampleRateRangesInput: mergeRanges(inputEndpoints),
      nominalSampleRateInput: hostsDefaultInput && selectedInput?.rate > 0 ? selectedInput.rate : null,
      actualSampleRateInput: hostsDefaultInput && selectedInput?.rate > 0 ? selectedInput.rate : null,
      availableSampleRateRangesOutput: mergeRanges(outputEndpoints),
      nominalSampleRateOutput: hostsDefaultOutput && selectedOutput?.rate > 0 ? selectedOutput.rate : null,
      actualSampleRateOutput: hostsDefaultOutput && selectedOutput?.rate > 0 ? selectedOutput.rate : null,
      maxSupportedOutputRate: Math.max(0, ...mergeRanges(outputEndpoints).map((range) => range.maximum)) || null,
      inputChannels: selectedInput?.channels ?? 0,
      outputChannels: selectedOutput?.channels ?? 0,
      isRunning: hostsDefaultOutput || hostsDefaultInput,
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
  const result = runProbeScriptSync();
  rememberProbeResult(result);
  return {
    timestamp: new Date().toISOString(),
    devices: aggregatePhysicalDevices(result),
  };
}

export async function readAudioDevicesAsync(): Promise<AudioProbeSnapshot> {
  const result = await runProbeScriptAsync();
  rememberProbeResult(result);
  return {
    timestamp: new Date().toISOString(),
    devices: aggregatePhysicalDevices(result),
  };
}

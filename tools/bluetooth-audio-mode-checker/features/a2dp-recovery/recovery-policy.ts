import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import type { RecoveryCauseKind, RecoveryRouteChoice } from "./types.ts";

export type RouteDevicePriority = 0 | 1 | 2 | 3;

const explicitWiredTransportFragments = [
  "usb",
  "2.4g",
  "2-4g",
  "2_4g",
  "receiver",
  "display-port",
  "displayport",
  "hdmi",
  "thunderbolt",
  "firewire",
  "pci",
  "line",
  "digital",
  "spdif",
];

export function routeDevicePriority(device: RawAudioDevice): RouteDevicePriority {
  const transport = (device.transport ?? "").trim().toLowerCase();
  if (transport.includes("bluetooth")) return 3;
  if (transport === "built-in" || transport.includes("builtin")) return 0;
  if (explicitWiredTransportFragments.some((fragment) => transport.includes(fragment))) return 1;
  return 2;
}

export function routeDevicePriorityLabel(device: RawAudioDevice): string {
  const labels = ["内置", "其他有线或接收器", "其他非蓝牙", "其他蓝牙"] as const;
  return labels[routeDevicePriority(device)];
}

function uniqueDevices(devices: RawAudioDevice[], direction: "input" | "output"): RawAudioDevice[] {
  const byName = new Map<string, RawAudioDevice>();
  for (const device of devices) {
    const channels = direction === "input" ? device.inputChannels : device.outputChannels;
    if (channels <= 0) continue;
    const existing = byName.get(device.name);
    const isDefault = direction === "input" ? device.isDefaultInput : device.isDefaultOutput;
    if (!existing || isDefault) byName.set(device.name, device);
  }
  return [...byName.values()];
}

export function orderedRouteCandidates(
  devices: RawAudioDevice[],
  direction: "input" | "output",
  excludedNames: Iterable<string> = [],
): RawAudioDevice[] {
  const excluded = new Set(excludedNames);
  return uniqueDevices(devices, direction)
    .filter((device) => !excluded.has(device.name))
    .map((device, index) => ({ device, index }))
    .sort((left, right) =>
      routeDevicePriority(left.device) - routeDevicePriority(right.device) ||
      left.index - right.index
    )
    .map(({ device }) => device);
}

function highestPriorityCandidates(devices: RawAudioDevice[]): RawAudioDevice[] {
  const priority = devices[0] ? routeDevicePriority(devices[0]) : null;
  return priority === null
    ? []
    : devices.filter((device) => routeDevicePriority(device) === priority);
}

export function selectCauseRoute(
  multiEndpointConfirmed: boolean,
  hasConfirmedOccupancy: boolean,
  linkResidualConfirmed: boolean,
  formatRequestConfirmed: boolean,
): RecoveryCauseKind {
  if (hasConfirmedOccupancy) return "麦克风占用类";
  if (multiEndpointConfirmed) return "多端点会话类";
  if (linkResidualConfirmed) return "链路残留类";
  if (formatRequestConfirmed) return "格式请求类";
  return "证据不足";
}

export function createMultiEndpointRouteChoices(
  devices: RawAudioDevice[],
  targetOutputName: string,
): RecoveryRouteChoice[] {
  const inputs = uniqueDevices(devices, "input");
  const outputs = uniqueDevices(devices, "output");
  const currentInput = inputs.find((device) => device.isDefaultInput);
  const currentOutput = outputs.find((device) => device.isDefaultOutput);
  const choices: RecoveryRouteChoice[] = [];

  const outputCandidates = highestPriorityCandidates(orderedRouteCandidates(
    devices,
    "output",
    currentOutput ? [currentOutput.name] : [],
  ));
  const inputCandidates = highestPriorityCandidates(orderedRouteCandidates(
    devices,
    "input",
    currentInput ? [currentInput.name] : [],
  ));

  for (const device of outputCandidates) {
    const usesCurrentInputDevice = currentInput?.name === device.name;
    choices.push({
      id: `output:${device.name}`,
      direction: "output",
      deviceName: device.name,
      label: usesCurrentInputDevice
        ? `输入输出都改用“${device.name}”`
        : `保留当前麦克风，扬声器改为“${device.name}”`,
      preserves: "输入",
    });
  }
  for (const device of inputCandidates) {
    const usesCurrentOutputDevice = currentOutput?.name === device.name || targetOutputName === device.name;
    choices.push({
      id: `input:${device.name}`,
      direction: "input",
      deviceName: device.name,
      label: usesCurrentOutputDevice
        ? `输入输出都改用“${device.name}”`
        : `保留当前扬声器，麦克风改为“${device.name}”`,
      preserves: "输出",
    });
  }

  return [...new Map(choices.map((choice) => [choice.id, choice] as const)).values()];
}

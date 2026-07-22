import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

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

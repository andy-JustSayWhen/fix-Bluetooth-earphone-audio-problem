import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import type { RecoveryCauseKind, RecoveryRouteChoice } from "./types.ts";

function isBluetooth(device: RawAudioDevice): boolean {
  return device.transport === "bluetooth" || device.transport === "bluetooth-le";
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

export function selectCauseRoute(
  hasConfirmedOccupancy: boolean,
  multiEndpointConfirmed: boolean,
  formatRequestConfirmed: boolean,
): RecoveryCauseKind {
  if (hasConfirmedOccupancy) return "麦克风占用类";
  if (multiEndpointConfirmed) return "多端点会话类";
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

  for (const device of outputs.filter((item) => !isBluetooth(item) && !item.isDefaultOutput)) {
    choices.push({
      id: `output:${device.name}`,
      direction: "output",
      deviceName: device.name,
      label: `保留当前麦克风，扬声器改为“${device.name}”`,
      preserves: "输入",
    });
  }
  for (const device of inputs.filter((item) => !isBluetooth(item) && !item.isDefaultInput)) {
    choices.push({
      id: `input:${device.name}`,
      direction: "input",
      deviceName: device.name,
      label: `保留当前扬声器，麦克风改为“${device.name}”`,
      preserves: "输出",
    });
  }

  if (currentInput && isBluetooth(currentInput) && currentInput.name !== currentOutput?.name) {
    const sameDeviceOutput = outputs.find((device) => device.name === currentInput.name);
    if (sameDeviceOutput) {
      choices.push({
        id: `output:${sameDeviceOutput.name}`,
        direction: "output",
        deviceName: sameDeviceOutput.name,
        label: `输入输出都改用“${sameDeviceOutput.name}”`,
        preserves: "输入",
      });
    }
  }

  if (currentOutput?.name === targetOutputName) {
    const sameDeviceInput = inputs.find((device) => device.name === targetOutputName);
    if (sameDeviceInput && !sameDeviceInput.isDefaultInput) {
      choices.push({
        id: `input:${sameDeviceInput.name}`,
        direction: "input",
        deviceName: sameDeviceInput.name,
        label: `输入输出都改用“${sameDeviceInput.name}”`,
        preserves: "输出",
      });
    }
  }

  return [...new Map(choices.map((choice) => [choice.id, choice] as const)).values()];
}

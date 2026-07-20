import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AudioProbeSnapshot,
  RawAudioDevice,
  SampleRateRange,
} from "../../shared/audio-device-types/index.ts";

type SystemProfilerDevice = Record<string, string | number | undefined> & {
  _name?: string;
};

type ConnectedBluetoothDevice = {
  address?: string;
  services: string[];
};

type DeviceFormatFacts = {
  name: string;
  inputChannels: number;
  outputChannels: number;
  nominalSampleRate: number;
  actualSampleRate: number;
  availableSampleRateRanges: SampleRateRange[];
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const rateSourcePath = join(moduleDirectory, "read-device-formats.c");
const rateBuildDirectory = join(toolRoot, ".build", "audio-probe");
const rateExecutablePath = join(rateBuildDirectory, "read-device-formats");

function modificationTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function ensureRateHelperBuilt(): void {
  if (modificationTime(rateExecutablePath) >= modificationTime(rateSourcePath)) return;
  mkdirSync(rateBuildDirectory, { recursive: true });
  execFileSync("/usr/bin/clang", [
    rateSourcePath,
    "-framework", "CoreAudio",
    "-framework", "CoreFoundation",
    "-o", rateExecutablePath,
  ], { stdio: ["ignore", "inherit", "inherit"] });
}

function readDeviceFormatFacts(): DeviceFormatFacts[] {
  try {
    ensureRateHelperBuilt();
    const output = execFileSync(rateExecutablePath, { encoding: "utf8" }).trim();
    const parsed = JSON.parse(output) as DeviceFormatFacts[];
    return parsed.map((facts) => ({
      ...facts,
      nominalSampleRate: Number(facts.nominalSampleRate) || 0,
      actualSampleRate: Number(facts.actualSampleRate) || 0,
      availableSampleRateRanges: (facts.availableSampleRateRanges ?? [])
        .map((range) => ({
          minimum: Number(range.minimum) || 0,
          maximum: Number(range.maximum) || 0,
        }))
        .filter((range) => range.minimum > 0 && range.maximum > 0),
    }));
  } catch {
    return [];
  }
}

function chooseFormatFacts(
  facts: DeviceFormatFacts[],
  name: string,
  direction: "input" | "output",
  reportedChannels: number,
): DeviceFormatFacts | undefined {
  const channelKey = direction === "input" ? "inputChannels" : "outputChannels";
  return facts
    .filter((entry) => entry.name === name && entry[channelKey] > 0)
    .sort((left, right) =>
      Math.abs(left[channelKey] - reportedChannels) - Math.abs(right[channelKey] - reportedChannels)
    )[0];
}

function validRate(rate: number | undefined): number | null {
  return rate && rate > 0 ? rate : null;
}

function runSystemProfiler(dataTypes: string[]): unknown {
  const result = execFileSync(
    "/usr/sbin/system_profiler",
    [...dataTypes, "-json"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(result) as unknown;
}

function connectedBluetoothDevices(parsed: unknown): Map<string, ConnectedBluetoothDevice> {
  const bluetoothReport = parsed as {
    SPBluetoothDataType?: Array<{
      device_connected?: Array<Record<string, Record<string, string | undefined>>>;
    }>;
  };
  const devices = new Map<string, ConnectedBluetoothDevice>();
  for (const group of bluetoothReport.SPBluetoothDataType ?? []) {
    for (const entry of group.device_connected ?? []) {
      for (const [name, values] of Object.entries(entry)) {
        const serviceText = values.device_services ?? "";
        const bracketContent = serviceText.match(/<\s*([^>]+)\s*>/)?.[1] ?? "";
        devices.set(name.toLocaleLowerCase(), {
          address: values.device_address,
          services: bracketContent.trim().split(/\s+/).filter(Boolean),
        });
      }
    }
  }
  return devices;
}

function transportName(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  if (value.includes("bluetooth_le")) {
    return "bluetooth-le";
  }
  if (value.includes("bluetooth")) {
    return "bluetooth";
  }
  if (value.includes("usb")) return "usb";
  if (value.includes("builtin")) return "built-in";
  if (value.includes("hdmi") || value.includes("displayport")) return "display-port";
  if (value.includes("virtual")) return "virtual";
  if (value.includes("aggregate")) return "aggregate";
  return value;
}

export function readAudioDevices(): AudioProbeSnapshot {
  if (process.platform !== "darwin") {
    throw new Error("本工具当前只支持 macOS。");
  }

  const parsed = runSystemProfiler(["SPAudioDataType", "SPBluetoothDataType"]) as {
    SPAudioDataType?: Array<{ _items?: SystemProfilerDevice[] }>;
    SPBluetoothDataType?: Array<{
      device_connected?: Array<Record<string, Record<string, string | undefined>>>;
    }>;
  };
  const bluetoothDevices = connectedBluetoothDevices(parsed);
  const records = parsed.SPAudioDataType?.flatMap((group) => group._items ?? []) ?? [];
  const formatFacts = readDeviceFormatFacts();
  const devices: RawAudioDevice[] = records.map((record, index) => {
    const name = record._name ?? "未命名音频设备";
    const reportedInputChannels = Number(record.coreaudio_device_input ?? 0);
    const reportedOutputChannels = Number(record.coreaudio_device_output ?? 0);
    const inputFacts = chooseFormatFacts(formatFacts, name, "input", reportedInputChannels);
    const outputFacts = chooseFormatFacts(formatFacts, name, "output", reportedOutputChannels);
    const inputChannels = inputFacts?.inputChannels ?? reportedInputChannels;
    const outputChannels = outputFacts?.outputChannels ?? reportedOutputChannels;
    const profilerSampleRate = Number(record.coreaudio_device_srate ?? 0) || null;
    const nominalSampleRateInput = validRate(inputFacts?.nominalSampleRate) ?? (inputChannels > 0 ? profilerSampleRate : null);
    const actualSampleRateInput = validRate(inputFacts?.actualSampleRate);
    const nominalSampleRateOutput = validRate(outputFacts?.nominalSampleRate) ?? (outputChannels > 0 ? profilerSampleRate : null);
    const actualSampleRateOutput = validRate(outputFacts?.actualSampleRate);
    const availableSampleRateRangesInput = inputFacts?.availableSampleRateRanges ?? [];
    const availableSampleRateRangesOutput = outputFacts?.availableSampleRateRanges ?? [];
    const maxSupportedOutputRate = Math.max(
      0,
      ...availableSampleRateRangesOutput.map((range) => range.maximum),
      nominalSampleRateOutput ?? 0,
      actualSampleRateOutput ?? 0,
    ) || null;
    const isDefaultInput = record.coreaudio_default_audio_input_device === "spaudio_yes";
    const isDefaultOutput = record.coreaudio_default_audio_output_device === "spaudio_yes";
    const isDefaultSystemOutput =
      record.coreaudio_default_audio_system_device === "spaudio_yes" ||
      record._properties === "coreaudio_default_audio_system_device";
    const bluetooth = bluetoothDevices.get(name.toLocaleLowerCase());

    return {
      id: index + 1,
      name,
      uid: `${name}-${index + 1}`,
      manufacturer: String(record.coreaudio_device_manufacturer ?? ""),
      transport: transportName(record.coreaudio_device_transport as string | undefined),
      sampleRateInput: inputChannels > 0 ? actualSampleRateInput ?? nominalSampleRateInput : null,
      sampleRateOutput: outputChannels > 0 ? actualSampleRateOutput ?? nominalSampleRateOutput : null,
      availableSampleRateRangesInput,
      nominalSampleRateInput,
      actualSampleRateInput,
      availableSampleRateRangesOutput,
      nominalSampleRateOutput,
      actualSampleRateOutput,
      maxSupportedOutputRate: outputChannels > 0 ? maxSupportedOutputRate : null,
      inputChannels,
      outputChannels,
      isRunning: isDefaultInput || isDefaultOutput || isDefaultSystemOutput,
      isDefaultInput,
      isDefaultOutput,
      isDefaultSystemOutput,
      bluetoothAddress: bluetooth?.address,
      supportedBluetoothServices: bluetooth?.services,
    };
  });

  return { timestamp: new Date().toISOString(), devices };
}

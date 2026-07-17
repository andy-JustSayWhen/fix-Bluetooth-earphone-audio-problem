import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AudioProbeSnapshot,
  RawAudioDevice,
} from "../../shared/audio-device-types/index.ts";

type SystemProfilerDevice = Record<string, string | number | undefined> & {
  _name?: string;
};

type ConnectedBluetoothDevice = {
  address?: string;
  services: string[];
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const rateSourcePath = join(moduleDirectory, "read-max-output-rate.c");
const rateBuildDirectory = join(toolRoot, ".build", "audio-probe");
const rateExecutablePath = join(rateBuildDirectory, "read-max-output-rate");
const maximumRateCache = new Map<string, number | null>();

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

function readMaxSupportedOutputRate(name: string): number | null {
  if (maximumRateCache.has(name)) return maximumRateCache.get(name) ?? null;
  try {
    ensureRateHelperBuilt();
    const output = execFileSync(rateExecutablePath, [name], { encoding: "utf8" }).trim();
    const rate = Number(output) || null;
    maximumRateCache.set(name, rate);
    return rate;
  } catch {
    maximumRateCache.set(name, null);
    return null;
  }
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
  const maxOutputRates = new Map<string, number | null>();
  for (const record of records) {
    if (Number(record.coreaudio_device_output ?? 0) <= 0 || !record._name) continue;
    if (!maxOutputRates.has(record._name)) {
      maxOutputRates.set(record._name, readMaxSupportedOutputRate(record._name));
    }
  }
  const devices: RawAudioDevice[] = records.map((record, index) => {
    const inputChannels = Number(record.coreaudio_device_input ?? 0);
    const outputChannels = Number(record.coreaudio_device_output ?? 0);
    const sampleRate = Number(record.coreaudio_device_srate ?? 0) || null;
    const isDefaultInput = record.coreaudio_default_audio_input_device === "spaudio_yes";
    const isDefaultOutput = record.coreaudio_default_audio_output_device === "spaudio_yes";
    const isDefaultSystemOutput =
      record.coreaudio_default_audio_system_device === "spaudio_yes" ||
      record._properties === "coreaudio_default_audio_system_device";
    const bluetooth = bluetoothDevices.get((record._name ?? "").toLocaleLowerCase());

    return {
      id: index + 1,
      name: record._name ?? "未命名音频设备",
      uid: `${record._name ?? "device"}-${index + 1}`,
      manufacturer: String(record.coreaudio_device_manufacturer ?? ""),
      transport: transportName(record.coreaudio_device_transport as string | undefined),
      sampleRateInput: inputChannels > 0 ? sampleRate : null,
      sampleRateOutput: outputChannels > 0 ? sampleRate : null,
      maxSupportedOutputRate: outputChannels > 0 ? maxOutputRates.get(record._name ?? "") ?? null : null,
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

import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
import { reconnectBluetoothDevice } from "../../core/macos-bluetooth-link/index.ts";
import { readMicrophoneUsers, releaseMicrophoneUser } from "../../core/macos-microphone-usage/index.ts";

export type A2dpRecoveryResult = {
  ok: boolean;
  sampleRate: number | null;
  releasedPrograms: string[];
  remainingPrograms: string[];
  message: string;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function currentOutputRate(name: string): number | null {
  const output = readAudioDevices().devices.find((device) =>
    device.name === name && device.outputChannels > 0 && device.isDefaultOutput
  );
  return output?.sampleRateOutput ?? null;
}

function preferredFallback(
  devices: ReturnType<typeof readAudioDevices>["devices"],
  direction: "input" | "output",
  excludedName: string,
) {
  const channelsKey = direction === "input" ? "inputChannels" : "outputChannels";
  return devices
    .filter((device) => device[channelsKey] > 0 && device.name !== excludedName && device.transport !== "bluetooth")
    .sort((left, right) => {
      const priority = (transport: string) => transport === "built-in" ? 3 : transport === "usb" ? 2 : 1;
      return priority(right.transport) - priority(left.transport);
    })[0];
}

async function waitUntilOutputAvailable(name: string): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const available = readAudioDevices().devices.some((device) =>
      device.name === name && device.outputChannels > 0
    );
    if (available) return true;
    await wait(200);
  }
  return false;
}

export async function recoverA2dp(name: string): Promise<A2dpRecoveryResult> {
  const snapshot = readAudioDevices();
  const target = snapshot.devices.find((device) => device.name === name && device.outputChannels > 0);
  if (!target || target.transport !== "bluetooth") throw new Error("所选蓝牙输出设备当前不可用");

  const inputFallback = preferredFallback(snapshot.devices, "input", name);
  if (target.isDefaultInput && !inputFallback) {
    return {
      ok: false,
      sampleRate: currentOutputRate(name),
      releasedPrograms: [],
      remainingPrograms: [],
      message: "没有可用的非蓝牙输入设备，无法阻止系统立即重新进入通话模式。",
    };
  }
  if (target.isDefaultInput && inputFallback) {
    setDefaultAudioDevice("input", inputFallback.name);
    await wait(500);
  }

  const users = readMicrophoneUsers().filter((user) => user.devices.includes(name));
  for (const user of users) releaseMicrophoneUser(user.pid);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const remaining = readMicrophoneUsers().filter((user) => user.devices.includes(name));
    if (remaining.length === 0) break;
    await wait(100);
  }
  const remaining = readMicrophoneUsers().filter((user) => user.devices.includes(name));
  if (remaining.length > 0) {
    return {
      ok: false,
      sampleRate: currentOutputRate(name),
      releasedPrograms: users.filter((user) => !remaining.some((item) => item.pid === user.pid)).map((user) => user.name),
      remainingPrograms: remaining.map((user) => user.name),
      message: `仍有程序正在读取该麦克风：${remaining.map((user) => user.name).join("、")}。`,
    };
  }

  const fallback = preferredFallback(snapshot.devices, "output", name);
  if (!fallback) {
    return {
      ok: false,
      sampleRate: currentOutputRate(name),
      releasedPrograms: users.map((user) => user.name),
      remainingPrograms: [],
      message: "没有可用的非蓝牙输出设备，无法安全重建蓝牙播放链路。",
    };
  }
  setDefaultAudioDevice("output", fallback.name);
  await wait(900);

  try {
    reconnectBluetoothDevice(name);
  } catch (error) {
    return {
      ok: false,
      sampleRate: null,
      releasedPrograms: users.map((user) => user.name),
      remainingPrograms: [],
      message: `麦克风占用已释放，但蓝牙链路重建失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!await waitUntilOutputAvailable(name)) {
    return {
      ok: false,
      sampleRate: null,
      releasedPrograms: users.map((user) => user.name),
      remainingPrograms: [],
      message: "蓝牙设备已尝试重新连接，但系统未重新提供它的声音输出。",
    };
  }
  setDefaultAudioDevice("output", name);

  let sampleRate: number | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(250);
    sampleRate = currentOutputRate(name);
    if (sampleRate !== null && sampleRate > 16_000) break;
  }
  const releasedPrograms = users.map((user) => user.name);
  if (sampleRate !== null && sampleRate > 16_000) {
    return {
      ok: true,
      sampleRate,
      releasedPrograms,
      remainingPrograms: [],
      message: `已恢复高音质输出，当前采样率为 ${sampleRate / 1000} kHz。`,
    };
  }
  return {
    ok: false,
    sampleRate,
    releasedPrograms,
    remainingPrograms: [],
    message: "麦克风占用和旧蓝牙链路均已释放，但输出仍未超过 16 kHz；请检查双设备连接或重新开始播放器的播放。",
  };
}

import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
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

export async function recoverA2dp(name: string): Promise<A2dpRecoveryResult> {
  const snapshot = readAudioDevices();
  const target = snapshot.devices.find((device) => device.name === name && device.outputChannels > 0);
  if (!target || target.transport !== "bluetooth") throw new Error("所选蓝牙输出设备当前不可用");

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

  const fallback = snapshot.devices
    .filter((device) => device.outputChannels > 0 && device.name !== name && device.transport !== "bluetooth")
    .sort((left, right) => Number(right.transport === "built-in") - Number(left.transport === "built-in"))[0];
  if (fallback) {
    setDefaultAudioDevice("output", fallback.name);
    await wait(350);
  }
  setDefaultAudioDevice("output", name);

  let sampleRate: number | null = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await wait(200);
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
    message: "本机麦克风占用已经释放，但输出仍未恢复；可能存在系统链路残留或非本机占用。",
  };
}

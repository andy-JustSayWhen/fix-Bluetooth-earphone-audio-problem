import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregatePhysicalDevices,
  formatBluetoothAddress,
  groupEndpointsByPhysicalDevice,
  stripBluetoothRoleSuffix,
  windowsMicrophoneUsers,
} from "./index.ts";
import type { WindowsProbeResult } from "./index.ts";

function endpoint(overrides: Record<string, unknown>): WindowsProbeResult["endpoints"][number] {
  return {
    flow: "eRender",
    id: "{0.0.0.00000000}.{00000000-0000-0000-0000-000000000000}",
    name: "扬声器 (测试设备)",
    rate: 48_000,
    channels: 2,
    bits: 32,
    transport: "usb",
    role: null,
    bluetoothAddress: null,
    canonicalId: null,
    physicalName: null,
    manufacturer: null,
    pnpFound: false,
    ...overrides,
  } as WindowsProbeResult["endpoints"][number];
}

const emptyDefaults = {
  renderConsole: null,
  renderComms: null,
  captureConsole: null,
};

test("启用麦克风时不同父路径的同容器端点仍为一副耳机", () => {
  const output = endpoint({id: "output", name: "耳机 (测试耳机)", transport: "bluetooth", containerId: "{11111111-2222-3333-4444-555555555555}", canonicalId: "output"});
  const input = endpoint({...output, id: "input", canonicalId: "input", flow: "eCapture", channels: 1, containerId: "11111111-2222-3333-4444-555555555555"});
  const before = aggregatePhysicalDevices({endpoints: [output], defaults: emptyDefaults});
  const after = aggregatePhysicalDevices({endpoints: [output, input], defaults: emptyDefaults});
  assert.equal(after.length, 1);
  assert.equal(after[0].name, "测试耳机");
  assert.equal(after[0].uid, before[0].uid);
  assert.equal(after[0].inputChannels, 1);
  assert.equal(after[0].outputChannels, 2);
});

test("同名不同容器不能合并，系统共享容器不能作为归组依据", () => {
  for (const containers of [
    ["11111111-2222-3333-4444-555555555555", "22222222-2222-3333-4444-555555555555"],
    ["00000000-0000-0000-FFFF-FFFFFFFFFFFF", "00000000-0000-0000-FFFF-FFFFFFFFFFFF"],
  ]) {
    const devices = aggregatePhysicalDevices({endpoints: containers.map((containerId, i) => endpoint({id: String(i), canonicalId: null, name: "同名耳机", transport: "bluetooth", containerId})), defaults: emptyDefaults});
    assert.equal(devices.length, 2);
    assert.notEqual(devices[0].name, devices[1].name);
  }
});

test("两台同型号非蓝牙设备保留独立身份和可区分名称", () => {
  const result: WindowsProbeResult = {endpoints: [
    endpoint({id: "first", canonicalId: "same-model"}),
    endpoint({id: "second", canonicalId: "same-model"}),
  ], defaults: emptyDefaults};
  const devices = aggregatePhysicalDevices(result);
  assert.equal(devices.length, 2);
  assert.notEqual(devices[0].name, devices[1].name);
  assert.notEqual(devices[0].uid, devices[1].uid);
});

test("剥离蓝牙端点名称中的角色后缀", () => {
  assert.equal(stripBluetoothRoleSuffix("耳机 (WH-1000XM5 Stereo)"), "WH-1000XM5");
  assert.equal(stripBluetoothRoleSuffix("耳机 (WH-1000XM5 立体声)"), "WH-1000XM5");
  assert.equal(stripBluetoothRoleSuffix("耳机 (WH-1000XM5 Hands-Free)"), "WH-1000XM5");
  assert.equal(stripBluetoothRoleSuffix("耳机 (WH-1000XM5 免提)"), "WH-1000XM5");
  assert.equal(stripBluetoothRoleSuffix("WH-1000XM5 Hands-Free AG Audio"), "WH-1000XM5");
  assert.equal(stripBluetoothRoleSuffix("Redmi 电脑音箱"), "Redmi 电脑音箱");
});

test("蓝牙地址格式化", () => {
  assert.equal(formatBluetoothAddress("aabbccddeeff"), "AA:BB:CC:DD:EE:FF");
  assert.equal(formatBluetoothAddress("AA:BB:CC:DD:EE:FF"), "AA:BB:CC:DD:EE:FF");
});

test("同一物理设备的蓝牙免提与立体声端点合并为一条设备记录", () => {
  const result: WindowsProbeResult = {
    endpoints: [
      endpoint({
        flow: "eRender",
        id: "{0.0.0.00000000}.{A1}",
        name: "耳机 (WH-1000XM5 Stereo)",
        rate: 48_000,
        channels: 2,
        transport: "bluetooth",
        role: "a2dp",
        bluetoothAddress: "AABBCCDDEEFF",
        canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF",
        physicalName: "WH-1000XM5",
      }),
      endpoint({
        flow: "eRender",
        id: "{0.0.0.00000000}.{A2}",
        name: "耳机 (WH-1000XM5 Hands-Free)",
        rate: 16_000,
        channels: 1,
        transport: "bluetooth",
        role: "handsfree",
        bluetoothAddress: "AABBCCDDEEFF",
        canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF",
        physicalName: "WH-1000XM5",
      }),
      endpoint({
        flow: "eCapture",
        id: "{0.0.1.00000000}.{A3}",
        name: "麦克风 (WH-1000XM5 Hands-Free)",
        rate: 16_000,
        channels: 1,
        transport: "bluetooth",
        role: "handsfree",
        bluetoothAddress: "AABBCCDDEEFF",
        canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF",
        physicalName: "WH-1000XM5",
      }),
    ],
    defaults: emptyDefaults,
  };
  const groups = groupEndpointsByPhysicalDevice(result);
  assert.equal(groups.length, 1);
  const devices = aggregatePhysicalDevices(result);
  assert.equal(devices.length, 1);
  const device = devices[0];
  assert.equal(device.name, "WH-1000XM5");
  assert.equal(device.transport, "bluetooth");
  assert.equal(device.bluetoothAddress, "AA:BB:CC:DD:EE:FF");
  assert.equal(device.outputChannels, 2);
  assert.equal(device.sampleRateOutput, 48_000);
  assert.equal(device.maxSupportedOutputRate, null);
  assert.equal(device.isDefaultOutput, false);
  assert.equal(device.actualSampleRateOutput, null);
  assert.equal(device.inputChannels, 1);
});

test("默认免提端点保留混音格式，实际传输与硬件能力保持未知", () => {
  const result: WindowsProbeResult = {
    endpoints: [
      endpoint({
        id: "{0.0.0.00000000}.{A1}",
        name: "耳机 (WH-1000XM5 Stereo)",
        rate: 48_000,
        channels: 2,
        transport: "bluetooth",
        role: "a2dp",
        bluetoothAddress: "AABBCCDDEEFF",
        canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF",
        physicalName: "WH-1000XM5",
      }),
      endpoint({
        id: "{0.0.0.00000000}.{A2}",
        name: "耳机 (WH-1000XM5 Hands-Free)",
        rate: 16_000,
        channels: 1,
        transport: "bluetooth",
        role: "handsfree",
        bluetoothAddress: "AABBCCDDEEFF",
        canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF",
        physicalName: "WH-1000XM5",
      }),
    ],
    defaults: {
      ...emptyDefaults,
      renderConsole: { id: "{0.0.0.00000000}.{A2}", name: "耳机 (WH-1000XM5 Hands-Free)", rate: 16_000, channels: 1, bits: 16 },
    },
  };
  const devices = aggregatePhysicalDevices(result);
  const device = devices[0];
  assert.equal(device.isDefaultOutput, true);
  assert.equal(device.isRunning, false);
  assert.equal(device.nominalSampleRateOutput, null);
  assert.equal(device.actualSampleRateOutput, null);
  assert.equal(device.outputChannels, 1);
  assert.equal(device.sampleRateOutput, 16_000);
  assert.equal(device.maxSupportedOutputRate, null);
});

test("非蓝牙端点按端点单独成记录并标注活动参数", () => {
  const result: WindowsProbeResult = {
    endpoints: [
      endpoint({ id: "{0.0.0.00000000}.{B1}", name: "扬声器 (USB2.0 Speaker)", transport: "usb", canonicalId: "USB\\VID_345F&PID_9132" }),
      endpoint({ flow: "eCapture", id: "{0.0.1.00000000}.{B2}", name: "麦克风 (USB2.0 Speaker)", rate: 44_100, channels: 1, transport: "usb", canonicalId: "USB\\VID_345F&PID_9132" }),
    ],
    defaults: {
      ...emptyDefaults,
      renderConsole: { id: "{0.0.0.00000000}.{B1}", name: "扬声器 (USB2.0 Speaker)", rate: 48_000, channels: 2, bits: 32 },
    },
  };
  const devices = aggregatePhysicalDevices(result);
  assert.equal(devices.length, 2);
  const speaker = devices.find((device) => device.name === "扬声器 (USB2.0 Speaker)");
  const microphone = devices.find((device) => device.name === "麦克风 (USB2.0 Speaker)");
  assert.ok(speaker && microphone);
  assert.equal(speaker.transport, "usb");
  assert.equal(speaker.isDefaultOutput, true);
  assert.equal(speaker.actualSampleRateOutput, null);
  assert.equal(microphone.isDefaultInput, false);
  assert.equal(microphone.actualSampleRateInput, null);
  assert.equal(microphone.sampleRateInput, 44_100);
});

test("蓝牙物理设备名称缺失时回退为端点名剥离角色后缀", () => {
  const result: WindowsProbeResult = {
    endpoints: [
      endpoint({
        id: "{0.0.0.00000000}.{C1}",
        name: "耳机 (Soundcore P40i 免提)",
        rate: 16_000,
        channels: 1,
        transport: "bluetooth",
        role: "handsfree",
        bluetoothAddress: "112233445566",
        canonicalId: "BTHENUM\\DEV_112233445566",
        physicalName: null,
      }),
    ],
    defaults: emptyDefaults,
  };
  const devices = aggregatePhysicalDevices(result);
  assert.equal(devices[0].name, "Soundcore P40i");
});

test("系统隐私记录在活动会话消失后仍保留程序并列出多个关联端点", () => {
  const result: WindowsProbeResult = {
    endpoints: [
      endpoint({flow: "eCapture", id: "redmi", name: "麦克风 (Redmi 电脑音箱)", sessions: [{pid: 40276, name: "RiotClientServices", id: "redmi-session", state: "inactive"}]}),
      endpoint({flow: "eCapture", id: "xiberia", name: "耳机 (2- XIBERIA K03S)", physicalName: "XIBERIA K03S", transport: "bluetooth", bluetoothAddress: "50C0F0F36A66", sessions: [{pid: 40276, name: "RiotClientServices", id: "xiberia-session", state: "inactive"}]}),
    ],
    defaults: emptyDefaults,
    microphonePrivacyUsers: [{pid: 40276, name: "Riot Client", path: "D:\\Riot Client\\RiotClientServices.exe", startedAt: "2026-09-15T06:18:53Z"}],
  };

  const users = windowsMicrophoneUsers(result);
  assert.deepEqual(users.map(user => ({
    pid: user.pid,
    name: user.name,
    devices: user.devices,
    privacyUsageActive: user.privacyUsageActive,
    deviceAssociationKind: user.deviceAssociationKind,
  })), [{
    pid: 40276,
    name: "Riot Client",
    devices: ["麦克风 (Redmi 电脑音箱)", "XIBERIA K03S"],
    privacyUsageActive: true,
    deviceAssociationKind: "ambiguous",
  }]);
});

test("活动端点会话优先于系统隐私记录且暂不活跃会话不算端点占用", () => {
  const active = endpoint({flow: "eCapture", id: "active", name: "麦克风 (Redmi 电脑音箱)", sessions: [{pid: 42, name: "voice", id: "active-session", state: "active"}]});
  const inactive = endpoint({flow: "eCapture", id: "inactive", name: "麦克风 (旧设备)", sessions: [{pid: 42, name: "voice", id: "inactive-session", state: "inactive"}]});
  const result: WindowsProbeResult = {
    endpoints: [active, inactive],
    defaults: emptyDefaults,
    microphonePrivacyUsers: [{pid: 42, name: "语音程序", path: "D:\\voice.exe", startedAt: null}],
  };

  assert.equal(aggregatePhysicalDevices(result).find(device => device.name === "麦克风 (旧设备)")?.isRunning, false);
  const users = windowsMicrophoneUsers(result);
  assert.equal(users.length, 1);
  assert.equal(users[0].name, "语音程序");
  assert.deepEqual(users[0].devices, ["麦克风 (Redmi 电脑音箱)"]);
  assert.equal(users[0].privacyUsageActive, true);
  assert.equal(users[0].deviceAssociationKind, "confirmed");
});

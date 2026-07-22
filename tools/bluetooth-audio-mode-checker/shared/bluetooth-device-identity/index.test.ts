import assert from "node:assert/strict";
import test from "node:test";

import {
  bluetoothPhysicalIdentity,
  isBluetoothTransport,
  normalizeBluetoothAddress,
} from "./index.ts";

test("蓝牙地址的分隔符和大小写不会产生不同设备", () => {
  assert.equal(normalizeBluetoothAddress("50:c0:f0:f3:6a:66"), "50C0F0F36A66");
  assert.equal(normalizeBluetoothAddress("50-C0-F0-F3-6A-66"), "50C0F0F36A66");
  assert.equal(
    bluetoothPhysicalIdentity("50:c0:f0:f3:6a:66", "旧名称"),
    bluetoothPhysicalIdentity("50-C0-F0-F3-6A-66", "新名称"),
  );
});

test("没有地址时才使用整理后的设备名称", () => {
  assert.equal(bluetoothPhysicalIdentity(null, "  REDMI  "), "name:redmi");
  assert.equal(bluetoothPhysicalIdentity(undefined, "redmi"), "name:redmi");
});

test("经典蓝牙和低功耗蓝牙传输都属于蓝牙", () => {
  assert.equal(isBluetoothTransport("Bluetooth"), true);
  assert.equal(isBluetoothTransport("Bluetooth Low Energy"), true);
  assert.equal(isBluetoothTransport("USB"), false);
});

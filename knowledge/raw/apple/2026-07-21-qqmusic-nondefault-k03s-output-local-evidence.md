# 2026-07-21 QQ音乐指定非默认 K03S 输出的本机原始证据

## 证据信息

- 证据性质：macOS 本机统一日志、蓝牙音频模式检查器快照与用户截图，不是 Apple 公开机制说明。
- 抓取日期：2026-07-21。
- 宿主机：`andy的macbook air`；MacBookAir10,1；Apple M1；macOS 14.6.1 / 23G93。
- 目标设备：XIBERIA K03S，蓝牙地址 `50:C0:F0:F3:6A:66`。
- 另一蓝牙设备：DJI Mic Mini-9DC1E8，蓝牙地址 `58:B8:58:9D:C1:E8`。
- 应用：QQ音乐 9.2.5（内部版本 73236），进程号 35685，标识 `com.tencent.QQMusicMac`。
- 系统日志查询窗口：2026-07-21 04:30:00–04:39:30（Asia/Shanghai）。
- 日志查询范围：`coreaudiod`、`audiomxd`、`bluetoothd`、`audioaccessoryd` 中与 QQ音乐会话、设备端点、`tacl/tsco`、A2DP/HFP 流和格式请求有关的行。

## 应用指定 K03S 输出时的直接日志

04:33 的这次播放中，QQ音乐会话只声明 K03S 输出端点，没有输入端点，系统选择 `tacl`。

```text
2026-07-21 04:33:17.563  Session <ID: 1, PID = 35685, Name = QQMusic, BundleID = com.tencent.QQMusicMac, Category = MediaPlayback, Mode = Default, Active = YES, Playing = YES, Recording = NO> is going active
2026-07-21 04:33:17.578  Starting IO on profile tacl, 0 to 50:C0:F0:F3:6A:66-tacl
2026-07-21 04:33:17.598  BluetoothHALPlugIn_StartIO ... PID=35685
2026-07-21 04:33:17.665  { "action":"update_running_state", "session":{"name":"QQMusic(35685)"}, "details":{"deviceUIDs":["50-C0-F0-F3-6A-66:output"],"implicit_category":"MediaPlayback","input_running":false,"output_running":true} }
2026-07-21 04:33:17.666  Calling to request for ownership on shared route com.tencent.QQMusicMac, isDoingIO = YES, score = 301, deviceID = 50:C0:F0:F3:6A:66
```

04:38 的暂停后恢复播放再次得到同样的输出专用会话，并明确建立 A2DP 播放流。

```text
2026-07-21 04:38:39.518  Session <ID: 1, PID = 35685, Name = QQMusic, BundleID = com.tencent.QQMusicMac, Category = MediaPlayback, Mode = Default, Active = YES, Playing = YES, Recording = NO> is going active
2026-07-21 04:38:39.548  Attempting to start streaming to device 50:C0:F0:F3:6A:66
2026-07-21 04:38:39.593  Starting A2DP audio streaming to device 50:C0:F0:F3:6A:66
2026-07-21 04:38:39.593  Bluetooth Daemon: A2DP streaming to device 50:C0:F0:F3:6A:66: on
2026-07-21 04:38:39.595  BluetoothHALPlugIn_StartIO ... PID=35685
2026-07-21 04:38:39.662  { "action":"update_running_state", "session":{"name":"QQMusic(35685)"}, "details":{"deviceUIDs":["50-C0-F0-F3-6A-66:output"],"implicit_category":"MediaPlayback","input_running":false,"output_running":true} }
```

## 将 K03S 改成系统默认输出时的对照

工具日志记录 04:35:39 将系统默认输出改为 K03S。当时默认输入仍为 DJI Mic Mini。K03S 紧接着从 `tacl` 进入 `tsco`，QQ音乐也在该 `tsco` 端点启动输出。

```text
2026-07-21 04:35:39.536  工具请求把系统默认输出改为 XIBERIA K03S
2026-07-21 04:35:39.621  [50:C0:F0:F3:6A:66-output] Current profile tacl
2026-07-21 04:35:39.683  kBluetoothAudioDevicePropertyFormat request 0 ->1
2026-07-21 04:35:39.744  [50:C0:F0:F3:6A:66-output] Current profile tsco
2026-07-21 04:35:39.927  Starting IO on profile tsco, 0 to 50:C0:F0:F3:6A:66-tsco
2026-07-21 04:35:39.928  BluetoothHALPlugIn_StartIO ... PID=35685
```

恢复为非 K03S 的系统默认输出后，系统断开 K03S 的 HFP 声音连接，然后重建 A2DP。

```text
2026-07-21 04:35:43.477  Sco route is disabled for device 50:C0:F0:F3:6A:66
2026-07-21 04:35:43.617  Bluetooth Daemon: HFP streaming to device 50:C0:F0:F3:6A:66: off
2026-07-21 04:35:43.798  Starting IO on profile tacl, 0 to 50:C0:F0:F3:6A:66-tacl
2026-07-21 04:35:43.839  BluetoothHALPlugIn_StartIO ... PID=35685
2026-07-21 04:35:43.839  Starting A2DP audio streaming to device 50:C0:F0:F3:6A:66
2026-07-21 04:35:43.839  Bluetooth Daemon: A2DP streaming to device 50:C0:F0:F3:6A:66: on
```

## 端点快照

04:39 的工具快照中，K03S 不是默认输入或默认输出，但 QQ音乐仍在向它播放；K03S 为 `44.1 kHz / 2 声道 / tacl / A2DP`。DJI Mic Mini 同时是系统默认输入和默认输出，但不属于 QQ音乐的 K03S 输出会话。

## 证据能支持与不能支持的结论

可以直接确认：

1. QQ音乐能在不改变系统默认输出的情况下，单独打开 K03S 输出端点。
2. 本次成功窗口内，QQ音乐会话只包含 K03S 输出，不录音、不运行输入，系统建立 `tacl` 和 A2DP 播放流。
3. 同一轮实验中，把 K03S 改成系统默认输出时它曾进入 `tsco`；移出系统默认输入输出组合后，QQ音乐可继续通过 A2DP 向它播放。

不能直接确认：

1. 不能把“非默认设备”单独写成系统永远不建立 HFP 的根因；日志直接证明的是本次会话为输出专用会话。
2. 不能确认 QQ音乐退出后重开、Mac 重启、更换 Mac、更换蓝牙设备或更换应用后仍可稳定复现。
3. 不能推导其他进程读取 K03S 麦克风时它仍会保持 A2DP。

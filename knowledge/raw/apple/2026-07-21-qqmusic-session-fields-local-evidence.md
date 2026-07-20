# 2026-07-21 QQ音乐播放、暂停与闲置切换输出的本机原始证据

## 证据信息

- 证据性质：macOS 本机统一日志与用户同步操作记录，不是 Apple 公开字段定义。
- 抓取日期：2026-07-21。
- 宿主机：`andymacbook-air.local`；MacBookAir10,1；Apple M1；macOS 14.6.1 / 23G93。
- 应用：QQ音乐，进程号 4206，标识 `com.tencent.QQMusicMac`。
- 目标设备：XIBERIA K03S，蓝牙地址 `50:C0:F0:F3:6A:66`。
- 查询进程：`audiomxd`、`audioaccessoryd`。
- 查询窗口：2026-07-21 05:52:15–05:54:05（Asia/Shanghai）。
- 用户操作：点击播放，约 3 秒后暂停；暂停状态下随后连续修改两次 QQ音乐应用级输出设备。

## 播放开始

05:52:21，QQ音乐开始播放，运行状态事件同时给出 K03S 输出端点和正在运行的输出状态。

```text
2026-07-21 05:52:21.277  { "action":"update_running_state", "session":{"ID":"0x4997000","name":"QQMusic(4206)"}, "details":{"deviceUIDs":["50-C0-F0-F3-6A-66:output"],"implicit_category":"MediaPlayback","input_running":false,"output_running":true} }
2026-07-21 05:52:21.278  Session <ID: 1, PID = 4206, Name = QQMusic, BundleID = com.tencent.QQMusicMac, Category = MediaPlayback, Mode = Default, Active = YES, Playing = YES, Recording = NO> is going active
2026-07-21 05:52:21.279  Calling to request for ownership on shared route com.tencent.QQMusicMac, isDoingIO = YES, score = 301, deviceID = 50:C0:F0:F3:6A:66
2026-07-21 05:52:21.285  Routing request Wx 50:C0:F0:F3:6A:66 score 301 flag 1 app com.tencent.QQMusicMac fake hijack no, CID 0xC6F50003
2026-07-21 05:52:21.336  NowPlaying app state changed for application com.tencent.QQMusicMac, isPlaying = YES
```

## 暂停与状态清理

05:52:24，系统先把 QQ音乐会话标为不再播放和不再活动；约 7.1 秒后，运行状态事件才清空设备端点并把输出改为停止。

```text
2026-07-21 05:52:24.305  NowPlaying app state changed for application com.tencent.QQMusicMac, isPlaying = NO
2026-07-21 05:52:24.305  Session <ID: 1, PID = 4206, Name = QQMusic, BundleID = com.tencent.QQMusicMac, Category = MediaPlayback, Mode = Default, Active = NO, Playing = NO, Recording = NO> is going inactive
2026-07-21 05:52:31.437  { "action":"update_running_state", "session":{"ID":"0x4997000","name":"QQMusic(4206)"}, "details":{"deviceUIDs":[],"implicit_category":"","input_running":false,"output_running":false} }
```

## 暂停状态下修改两次应用级输出

用户确认在暂停状态下连续修改了两次 QQ音乐应用级输出设备。查询截至 05:54:05 的同一组系统日志，没有在 05:52:31.437 之后取得任何新的 QQ音乐记录：

- 没有新的 `update_running_state`。
- 没有新的 `deviceUIDs`。
- 没有新的 `output_running`。
- 没有新的 `deviceID` 或 `Routing request`。

这项“没有日志”的证据只覆盖上述宿主机、应用版本、系统版本、查询进程和时间窗口。

## 原始证据边界

本次日志可以直接证明：

1. QQ音乐实际播放时，`deviceUIDs`、`output_running:true`、`Active:YES` 和 `Playing:YES` 同时出现。
2. QQ音乐暂停后，`Active` 与 `Playing` 先变为 `NO`，`deviceUIDs` 和 `output_running` 延后约 7.1 秒清空。
3. 暂停状态下修改两次应用级输出，没有在本次查询范围内形成相应的系统声音会话或蓝牙路由日志。

本次日志不能直接证明：

1. 不能据此断言所有 macOS 版本或所有应用在闲置切换输出时都不产生日志。
2. 不能从 `output_running:true` 单独证明应用输出了非静音数据、耳机端实际发声或用户能听见声音。
3. 不能从空 `deviceUIDs` 判断 QQ音乐设置界面当前选中了哪个设备。

## 相关证据

- [QQ音乐指定非默认 K03S 输出的本机证据](2026-07-21-qqmusic-nondefault-k03s-output-local-evidence.md)

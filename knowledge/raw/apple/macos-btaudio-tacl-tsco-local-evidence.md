# macOS BTAudio 中 `tacl` 与 `tsco` 的本机日志证据

## 来源信息

- 证据产生方：Apple macOS（苹果电脑操作系统）的系统声音服务
- 采集机器：`andymacbook-air.local`，设备名称“andy的macbook air”
- 机器型号：MacBook Air，`MacBookAir10,1`，Apple M1（苹果自研芯片）
- 系统版本：macOS 14.6.1，构建版本 23G93
- 采集日期：2026-07-20
- 主要进程：`coreaudiod`（macOS 的系统声音服务）
- 日志子系统：`com.apple.bluetooth:BTAudio`（苹果蓝牙声音日志分类）
- 日志发送组件：`BTAudioHALPlugin`（连接蓝牙声音设备与系统声音服务的苹果组件）
- 清洗说明：只保留能证明 `tacl/tsco` 与声音路径对应关系的日志行；删除线程号以外的无关上下文，没有改写日志正文。
- 证据性质：苹果组件在本机产生的实测日志，不是苹果公开发布的术语说明文档。

---

## `tsco` 与 HFP 通话声音路径

2026-07-20 19:33:48，设备地址 `50:C0:F0:F3:6A:66` 开始使用麦克风时，同一时间窗出现以下日志：

```text
HFPInputShimDevice: StartIO ... transfering to device 50:C0:F0:F3:6A:66-tsco
... mA2DPAudioDevice ..., mHFPAudioDevice ..., mNextAudioDevice ...
Starting IO on profile tsco ... 50:C0:F0:F3:6A:66-tsco
... tsco, Profile Transport operation completed ... Creation
BTUnifiedAudioDevice: [50:C0:F0:F3:6A:66-output] ... Current profile tsco
```

其中 HFP（Hands-Free Profile，免提规范）输入设备、HFP 声音设备对象和 `tsco` 在同一切换过程中直接关联，证明在这版 macOS 的蓝牙声音实现中，`tsco` 是通话声音路径使用的内部标签。

## `tacl` 与 A2DP 高音质播放路径

2026-07-20 20:06:28，同一设备恢复到 44.1 kHz（千赫，表示每秒采样次数）的播放路径时，同一时间窗出现以下日志：

```text
UpdateCurrentBTAudioDeviceFromSampleRate A2DP 44100.000000 = 44100.000000
... mA2DPAudioDevice ..., mHFPAudioDevice ..., mNextAudioDevice ...
Number of output Controls for tacl = 3
A2DP Returning latency ...
BTUnifiedAudioDevice: [50:C0:F0:F3:6A:66-output] ... Current profile tacl
... Device 50:C0:F0:F3:6A:66-tacl
```

其中 A2DP（Advanced Audio Distribution Profile，高级音频分发规范）声音设备对象、A2DP 延迟信息和 `tacl` 在同一切换过程中直接关联，证明在这版 macOS 的蓝牙声音实现中，`tacl` 是高音质播放路径使用的内部标签。

## 组件中的固定日志格式

本机组件路径：

```text
/System/Library/Audio/Plug-Ins/HAL/BTAudioHALPlugin.driver/Contents/MacOS/BTAudioHALPlugin
```

该组件包含以下固定日志格式：

```text
Starting IO on profile %{public}s, %llu to %{public}@ mAudioObjectID: %u Wait IO Start %d
```

统一日志的记录还显示：运行进程是 `coreaudiod`，实际发送日志的镜像是上述 `BTAudioHALPlugin`。因此 `profile tacl/tsco` 是苹果声音组件写出的实现标签，不是本项目自行命名。

## 能证明与不能证明的内容

本机证据可以证明：

- `tacl` 与苹果当前的 A2DP 高音质播放声音路径相对应。
- `tsco` 与苹果当前的 HFP 通话声音路径相对应。
- 两个标签会进入设备内部识别编号，并出现在声音输入输出启动、停止和切换日志中。

本机证据不能证明：

- 苹果公开定义过 `tacl` 或 `tsco` 的正式全称。
- 字母 `t` 的官方展开一定是 `transport`（传输）；这只是结合 `Profile Transport operation` 等日志形成的合理推断。
- `tsco` 能区分底层实际使用的是 SCO（同步面向连接逻辑传输）还是 eSCO（扩展同步面向连接逻辑传输）。现代 HFP 可以使用 eSCO，但苹果仍可能沿用 `tsco` 标签。
- 这些内部标签构成稳定的公开 API（供程序正式调用且承诺兼容的接口）；系统升级后日志文字仍可能变化。

## 关联记录

- [2026-07-20 占用类前端实测](../../wiki/HFP一键修复前端实测/cases/2026-07-20-占用类前端实测.md)
- [Apple：macOS 蓝牙协议栈与公开接口边界](apple-bluetooth-stack-and-audio-profile-api.md)

# `tacl` 与 `tsco` 的真实含义和定义边界

## 结论

`ACL/SCO/eSCO` 是 Bluetooth SIG（蓝牙技术联盟）在蓝牙核心规范中定义的正式术语；小写的 `tacl/tsco` 是 Apple（苹果公司）蓝牙声音组件在 macOS（苹果电脑操作系统）中使用的内部日志标签。

本项目可确认的对应关系是：

| macOS 日志标签 | 本机直接对应的声音路径 | 适合页面展示的中文 |
| --- | --- | --- |
| `tacl` | A2DP 高音质播放路径 | `tacl（异步传输，用于单向音频播放）` |
| `tsco` | HFP 通话声音路径 | `tsco（同步传输，常用于语音通话）` |

不能把 `tacl` 和 A2DP、`tsco` 和 HFP 写成同一层的正式术语：前者是苹果内部实现标签，后者是蓝牙声音配置规范。

## 正式全称与中文翻译

Bluetooth Core Specification 6.3（蓝牙核心规范 6.3）给出的正式全称如下：

| 缩写 | 规范全称 | 本项目采用的中文直译 |
| --- | --- | --- |
| ACL | Asynchronous Connection-oriented Logical Transport | 异步面向连接逻辑传输 |
| SCO | Synchronous Connection-Oriented Logical Transport | 同步面向连接逻辑传输 |
| eSCO | Extended Synchronous Connection-Oriented Logical Transport | 扩展同步面向连接逻辑传输 |

中文译名是本项目采用的技术直译，不宣称是 Bluetooth SIG 发布的官方中文定名。旧资料有时把 ACL 展开成 `Asynchronous Connection-Less`，但当前蓝牙核心规范使用 `Connection-oriented`，本项目以当前规范为准。

来源：[Bluetooth SIG 传统蓝牙逻辑传输原文记录](../raw/bluetooth-sig/core-classic-logical-transports.md)。

## 三层概念不能混用

### 第一层：蓝牙声音配置规范

- A2DP（Advanced Audio Distribution Profile，高级音频分发规范）：面向高质量声音分发，典型场景是电脑向耳机播放音乐。
- HFP（Hands-Free Profile，免提规范）：面向双向语音和免提控制，典型场景是同时使用耳机播放和麦克风。

### 第二层：蓝牙逻辑传输

- ACL：异步、按数据包传输；大多数数据包可以重传。A2DP 媒体流运行在这类异步数据路径之上。
- SCO：同步、双向、预留传输时隙，不重传。
- eSCO：SCO 的扩展形式，支持更灵活的参数和有限重传；现代 HFP 通常可以使用它建立语音连接。

ACL/SCO/eSCO 是比 A2DP/HFP 更底层的传输概念。一个设备已经建立普通 ACL 连接，不代表它当前一定正在播放 A2DP 声音。

### 第三层：苹果内部标签

本机 `BTAudioHALPlugin（苹果蓝牙声音接入组件）` 的日志直接显示：

- HFP 输入和 HFP 声音设备切换时，设备内部识别编号带 `-tsco`，日志写入 `Current profile tsco`。
- A2DP 声音设备恢复到 44.1 kHz 高音质播放路径时，设备内部识别编号带 `-tacl`，日志写入 `Current profile tacl`。

因此，在当前本机系统版本中，`tacl/tsco` 可以作为两类声音路径的设备级事实使用。来源：[macOS BTAudio 本机日志证据](../raw/apple/macos-btaudio-tacl-tsco-local-evidence.md)。

## 字母 `t` 是否有官方全称

目前没有找到苹果公开文档对 `tacl` 和 `tsco` 给出正式展开。结合苹果日志中的 `Profile Transport operation`，把它们理解成 `transport ACL` 和 `transport SCO` 是合理推断，但不能写成苹果已经公开确认的全称。

严谨写法是：

- `tacl`：苹果日志中的 A2DP 高音质播放路径标签。
- `tsco`：苹果日志中的 HFP 通话声音路径标签。

不要写成：

- “`tacl` 的苹果官方全称就是 Transport ACL”。
- “`tsco` 一定证明底层使用传统 SCO 而不是 eSCO”。

## 对模式判定的意义

- `tsco` 是当前设备进入通话声音路径的强直接证据。
- `tacl` 表明苹果声音组件当前选择了高音质播放路径，但本项目仍需同时核对实际采样率和输出声道，不能只凭一个历史标签判定设备已经稳定恢复 A2DP。
- 标签必须按日志里的蓝牙地址归属到单台设备，不能把一台设备的最新链路套给其他设备。
- 没有新的 `tacl/tsco` 日志，只代表当前缺少链路事实；不能仅凭低采样率替设备补判通话模式。

具体产品规则以 [如何判定蓝牙音频设备的音频模式](../../reference/SPEC/如何判定蓝牙音频设备的音频模式.md) 为准。

## 适用范围和限制

- 本机映射证据来自 `andymacbook-air.local`、MacBook Air M1、macOS 14.6.1。
- 其他 macOS 版本应重新核对日志格式，不能假定苹果内部标签永久不变。
- 本文讨论传统蓝牙声音路径，不直接套用于 LE Audio（低功耗蓝牙音频）。
- `tacl/tsco` 不是苹果公开承诺稳定的程序接口；工具必须保留“无法确认”的结果，不能在日志缺失时编造链路类型。

## 冲突检查

现有知识把 `tacl` 描述为本机蓝牙立体声传输配置，把 `tsco` 描述为本机蓝牙通话传输配置。新证据没有推翻这组对应关系，而是补充了术语归属和边界：

- `ACL/SCO/eSCO` 的定义权属于 Bluetooth SIG。
- `tacl/tsco` 的具体字符串属于苹果内部实现。
- `tacl` 不能单独替代完整的 A2DP 模式验收。
- `tsco` 不能继续细分底层使用 SCO 还是 eSCO。

没有发现需要用户裁决的真实冲突。

## 来源

- [Bluetooth SIG：传统蓝牙逻辑传输、正式全称、重传与缓冲](../raw/bluetooth-sig/core-classic-logical-transports.md)
- [macOS BTAudio 中 `tacl` 与 `tsco` 的本机日志证据](../raw/apple/macos-btaudio-tacl-tsco-local-evidence.md)
- [Bluetooth SIG：HFP 音频连接建立与释放](../raw/bluetooth-sig/hfp-1.8-audio-connection.md)
- [Apple：macOS 蓝牙协议栈与公开接口边界](../raw/apple/apple-bluetooth-stack-and-audio-profile-api.md)
- [为什么 HFP 数据量更小却可能不如 A2DP 稳定](07-为什么HFP数据量更小却可能不如A2DP稳定.md)

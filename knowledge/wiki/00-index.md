# 蓝牙耳机麦克风与播放异常知识索引

## 这套资料解决什么问题

本索引服务于本项目要排查的问题：带麦克风的蓝牙耳机在播放期间被应用调用麦克风后，声音变空洞、失真、低码率、卡顿、静音，或恢复播放后仍未回到正常听感。

## 证据等级

- **官方直接事实**：Apple、Microsoft 或 Bluetooth SIG 原文明确写出的行为、条件和限制。
- **实机实测事实**：本项目按设备身份分别记录设备参数、系统日志和用户操作结果；2026-07-17 06:00 前的 Bose 与 K03S 记录属于 `MAC-home01-MacBookAir`，之后明确标为 `MACMINI9,1-175AC621` 或 `MAC-home02-MacMini` 的记录属于另一台 Mac mini。
- **来源支持的推论**：多个来源共同支持、且没有超出条件范围的解释。
- **尚未证实的推测**：需要额外抓取应用内部音频流、按键事件或设备固件信息才能确认的内容。

## 阅读顺序

1. [传统蓝牙麦克风为何会让播放质量下降](01-传统蓝牙麦克风导致播放质量下降.md)
2. [蓝牙音频模式与参数变化](02-蓝牙音频模式与参数变化.md)
3. [macOS 与 Windows 的官方处理方式](03-macOS与Windows官方处理方式.md)
4. [LE Audio 与硬件链路解决方案](04-LE-Audio与硬件解决方案.md)
5. [A2DP、HFP 与 LE Audio 概念对照](06-A2DP-HFP与LE-Audio概念对照.md)
6. [`tacl` 与 `tsco` 的真实含义和定义边界](tacl与tsco的真实含义和定义边界.md)
7. [为什么 HFP 数据量更小却可能不如 A2DP 稳定](07-为什么HFP数据量更小却可能不如A2DP稳定.md)
8. [采样率与声道听感对照案例](cases/2026-07-16-采样率与声道听感对照.md)
9. [跨设备蓝牙 HFP 降级的解决方案边界](07-跨设备蓝牙HFP降级的解决方案边界.md)
10. [HFP 与 A2DP 链路建立及恢复接口边界](08-HFP与A2DP链路建立及恢复接口边界.md)
11. [macOS 蓝牙与音频日志能力矩阵](09-macOS蓝牙与音频日志能力矩阵.md)
12. [2026-07-17 MAC-home02-MacMini 日志能力启用现场](cases/2026-07-17-MAC-home02日志启用现场.md)
13. [如何快速、完整地停用、恢复和监测 SoundSource](soundsource服务运维/00-SoundSource服务运维.md)
14. [2026-07-17 MAC-home02-MacMini SoundSource 服务运维实测](soundsource服务运维/cases/2026-07-17-MAC-home02-SoundSource服务运维实测.md)
15. [蓝牙音频设备进入HFP模式的原因](蓝牙音频设备进入HFP模式的原因.md)
16. [HFP 一键修复前端实测方法](HFP一键修复前端实测/00-HFP一键修复前端实测方法.md)
17. [进程与 App 触发原因映射表](进程与App触发原因映射表.md)

## 原文目录

### 官方资料

- [Apple：Mac 连接蓝牙耳机时音质降低](../raw/apple/apple-macos-bluetooth-headphones-sound-quality.md)
- [Apple：在 Mac 上创建组合声音设备](../raw/apple/apple-audio-midi-aggregate-device.md)
- [Apple：macOS 蓝牙协议栈与公开接口边界](../raw/apple/apple-bluetooth-stack-and-audio-profile-api.md)
- [Apple：macOS 蓝牙与音频诊断日志入口](../raw/apple/apple-macos-audio-bluetooth-diagnostic-logs.md)
- [Apple 开发者问答：HFP 双向输入输出路径](../raw/apple/apple-developer-forum-hfp-bidirectional-route.md)
- [Microsoft：传统蓝牙音频](../raw/microsoft/bluetooth-classic-audio.md)
- [Microsoft：通信场景下的音频格式能力](../raw/microsoft/communications-audio-format-capabilities.md)
- [Microsoft：蓝牙 LE Audio（低功耗蓝牙音频）](../raw/microsoft/bluetooth-low-energy-audio.md)
- [Bluetooth SIG：LE Audio](../raw/bluetooth-sig/le-audio.md)
- [Bluetooth SIG：A2DP（高级音频分发协议）](../raw/bluetooth-sig/a2dp.md)
- [Bluetooth SIG：HFP（免提协议）](../raw/bluetooth-sig/hfp.md)
- [Bluetooth SIG：HFP 1.8 音频连接建立与释放](../raw/bluetooth-sig/hfp-1.8-audio-connection.md)
- [Bluetooth SIG：传统蓝牙逻辑传输、重传与缓冲](../raw/bluetooth-sig/core-classic-logical-transports.md)

### 社区资料

- [Hammerspoon：AirPods 自动切换到其他麦克风](../raw/community/hammerspoon-airpods-microphone.md)
- [Hacker News：CrystalClear Sound 讨论](../raw/community/hacker-news-crystalclear-sound.md)
- [AirPods Sound Quality Fixer：自动改回其他输入的项目说明](../raw/community/airpods-sound-quality-fixer-readme.md)
- [ToothFairy：禁用设备声音输入功能说明](../raw/community/toothfairy-disable-audio-input.md)
- [HIKKIE!：2026 年 7 月各系统 LE Audio 支持状况综述](../raw/community/hikkie-leaudio-ready-2026-07.md)
- [BlueZ：A2DP 与 HFP 传输分别管理的实现证据](../raw/community/bluez-a2dp-hfp-transport-evidence.md)
- [Rogue Amoeba：SoundSource 调试日志](../raw/community/rogue-amoeba-soundsource-debug-logs.md)

### 本机系统原始证据

- [macOS BTAudio 中 `tacl` 与 `tsco` 的本机日志证据](../raw/apple/macos-btaudio-tacl-tsco-local-evidence.md)

## 本机实验案例

- [采样率与声道听感对照](cases/2026-07-16-采样率与声道听感对照.md)
- [2026-07-20 占用类前端实测](HFP一键修复前端实测/cases/2026-07-20-占用类前端实测.md)
- [2026-07-20 多端点会话类前端实测](HFP一键修复前端实测/cases/2026-07-20-多端点会话类前端实测.md)
- [2026-07-20 格式请求类前端实测](HFP一键修复前端实测/cases/2026-07-20-格式请求类前端实测.md)

## 本次新增文献的冲突检查

本次合并同时保留 `agent/bluetooth-audio-web-tool` 和 `agent/bluetooth-audio-knowledge` 的资料。两边资料没有发现需要用户裁决的真实冲突：

- Apple 用“高质量播放模式”和“麦克风加播放模式”描述 macOS 现象；Microsoft 用 A2DP 和 HFP 解释 Windows 传统蓝牙，描述层级不同但相互吻合。
- Microsoft 明确把 LE Audio 单独列出，并说明只有部分 Windows 11 电脑和设备组合能在使用麦克风时保持立体声；这不是对所有蓝牙耳机的普遍保证。
- Bluetooth SIG 当前规范目录页显示 A2DP 和 HFP 的规范版本信息，补充了协议层事实，不改变本项目基于 Windows、macOS 和本机实测的现象判断。
- A2DP/HFP 的 Bluetooth SIG 定义、Microsoft 的系统行为说明和已有 LE Audio 资料处于不同抽象层级，没有形成结论冲突。
- 社区资料记录的是绕过或自动化切换输入设备的实践，不能替代官方协议能力说明。

后续新增文献仍必须先进入 `raw/`，再逐项检查本索引及相关主题文档；如果出现无法按版本、设备、系统或来源质量化解的冲突，保留双方证据并提交用户裁决。

## 2026-07-17 HFP 音频连接与恢复接口调研的冲突检查

- 新资料没有推翻既有“麦克风使用会触发传统蓝牙低质量双向路径”的结论，而是补充了连接分层与恢复控制边界。
- 既有恢复规格中的“请求高采样率”超出了文献所能支持的作用范围；它将被从恢复动作降为恢复后的验证或格式请求，不保留为协议级恢复办法。
- BlueZ 的实现只作为分层旁证，不覆盖 macOS 的系统行为；Apple 公开文档未提供强制模式切换接口，因此不存在需要用户裁决的来源冲突。

## 2026-07-17 日志能力资料的冲突检查

- 新资料补充的是诊断证据的产生方式、启用状态和读取边界，没有改变既有 HFP/A2DP 模式结论。
- PacketLogger、统一日志、音频异常追踪和 sysdiagnose 的作用层级不同，不能互相替代；这与既有“模式结论需要端点参数和活动链路证据共同支持”的要求一致。
- 本机日志启用状态只适用于 `MAC-home02-MacMini`，未覆盖 `MAC-home01-MacBookAir` 的历史案例。
- SoundSource 官方调试日志补充应用内部声音处理和路由活动，不替代系统统一日志、蓝牙链路日志或实际端点参数；两类证据不存在冲突。
- 本轮未发现需要用户裁决的文献冲突。

## 2026-07-17 SoundSource 服务运维方法的冲突检查

- 新方法把“退出前台”“停止后台”和“完整移出驱动”分层，修正了把前台退出误当作完整停用的风险，没有覆盖既有实测证据。
- 停用与恢复命令只固化了 `MAC-home02-MacMini` 已核实的安装路径、任务标识和驱动身份；其他机器必须先重新探测。
- 方法保留应用、配置、许可证、日志和原驱动，不属于卸载或清除用户数据。
- 本轮未发现需要用户裁决的知识冲突。

## 2026-07-17 解决方案调研的冲突检查

本轮新增资料没有推翻既有结论：

- Apple 组合声音设备资料只说明通道组合、采样率、时钟源和漂移修正，没有承诺隔离蓝牙协议。因此它补充的是方案边界，不与既有“USB 或 2.4G 改变底层链路”的结论冲突。
- 自动改回其他麦克风的工具与既有 Hammerspoon 方案采用相同思路，属于自动化绕过，不是保留蓝牙输入 A 的修复。
- ToothFairy 的“禁用设备输入”功能在普通同设备场景可能有帮助；但本项目的输出 B 在麦克风未被选中时仍会降级。因此该功能只列为待验证候选，没有覆盖既有实测。
- Apple 工程师答复来自 iPhone 和助听设备场景，只作为 HFP 成对路径的架构旁证，没有改写 macOS 案例结论。

## 2026-07-17 各系统 LE Audio 社区综述的冲突检查

- 新文献与既有知识共同支持“耳机、主机硬件、驱动、系统和启用方式必须同时满足条件”，补充了不同产品的实际开关与配对形态。
- 文章对 Apple 系统的绝对判断证据强度低于既有官方资料要求，因此只作为 2026 年 7 月社区快照保留，没有覆盖既有谨慎结论。
- 文章中的具体产品清单、延迟、功耗和品牌推荐变化快或带有作者判断，未提升为官方事实；不存在需要用户裁决后才能继续的真实冲突。

## 2026-07-20 `tacl` 与 `tsco` 术语归属的冲突检查

- Bluetooth SIG 核心规范补充确认了 ACL、SCO 和 eSCO 的正式全称；这与既有传输机制说明一致。
- 本机苹果组件日志把 `tsco` 与 HFP 声音设备、把 `tacl` 与 A2DP 声音设备直接放在同一切换时序中，补强了既有映射。
- 苹果没有公开给出 `tacl/tsco` 的正式展开，因此没有把“`t` 等于 transport”提升为官方事实。
- 新知识明确 `tacl` 不能单独替代 A2DP 的完整模式验收，也不把 `tsco` 当作区分 SCO 与 eSCO 的包级证据。
- 本轮没有发现需要用户裁决的真实冲突。

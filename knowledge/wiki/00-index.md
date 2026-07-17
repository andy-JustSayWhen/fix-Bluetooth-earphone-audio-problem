# 蓝牙耳机麦克风与播放异常知识索引

## 这套资料解决什么问题

本索引服务于本项目要排查的问题：带麦克风的蓝牙耳机在播放期间被应用调用麦克风后，声音变空洞、失真、低码率、卡顿、静音，或恢复播放后仍未回到正常听感。

## 证据等级

- **官方直接事实**：Apple、Microsoft 或 Bluetooth SIG（蓝牙技术联盟）原文明确写出的行为、条件和限制。
- **本机实测事实**：本项目在同一台 macOS 设备上记录的设备参数、系统日志和用户操作结果。
- **来源支持的推论**：多个来源共同支持、且没有超出条件范围的解释。
- **尚未证实的推测**：需要额外抓取应用内部音频流或设备固件信息才能确认的内容。

## 阅读顺序

1. [传统蓝牙麦克风为何会让播放质量下降](01-传统蓝牙麦克风导致播放质量下降.md)
2. [蓝牙音频模式与参数变化](02-蓝牙音频模式与参数变化.md)
3. [macOS 与 Windows 的官方处理方式](03-macOS与Windows官方处理方式.md)
4. [LE Audio 与硬件链路解决方案](04-LE-Audio与硬件解决方案.md)
5. [本机 Bose 与 K03S 实测对照](05-本机K03S与Bose实测对照.md)
6. [K03S 蓝牙与 2.4G 接收器对照案例](cases/2026-07-16-K03S蓝牙与2.4G对照.md)
7. [A2DP、HFP 与 LE Audio 概念对照](06-A2DP-HFP与LE-Audio概念对照.md)
8. [采样率与声道听感对照案例](cases/2026-07-16-采样率与声道听感对照.md)
9. [为什么 HFP 数据量更小却可能不如 A2DP 稳定](07-为什么HFP数据量更小却可能不如A2DP稳定.md)

## 原文目录

### 官方资料

- [Apple：Mac 连接蓝牙耳机时音质降低](../raw/apple/apple-macos-bluetooth-headphones-sound-quality.md)
- [Microsoft：传统蓝牙音频](../raw/microsoft/bluetooth-classic-audio.md)
- [Microsoft：通信场景下的音频格式能力](../raw/microsoft/communications-audio-format-capabilities.md)
- [Microsoft：蓝牙 LE Audio（低功耗蓝牙音频）](../raw/microsoft/bluetooth-low-energy-audio.md)
- [Bluetooth SIG：LE Audio](../raw/bluetooth-sig/le-audio.md)
- [Bluetooth SIG：A2DP（高级音频分发协议）](../raw/bluetooth-sig/a2dp.md)
- [Bluetooth SIG：HFP（免提协议）](../raw/bluetooth-sig/hfp.md)
- [Bluetooth SIG：传统蓝牙逻辑传输、重传与缓冲](../raw/bluetooth-sig/core-classic-logical-transports.md)

### 社区资料

- [Hammerspoon：AirPods 自动切换到其他麦克风](../raw/community/hammerspoon-airpods-microphone.md)
- [Hacker News：CrystalClear Sound 讨论](../raw/community/hacker-news-crystalclear-sound.md)

## 本机实验案例

- [采样率与声道听感对照](cases/2026-07-16-采样率与声道听感对照.md)

## 本次新增文献的冲突检查

本次新增 A2DP 和 HFP 的 Bluetooth SIG 规范目录页，并新建三者概念对照文档。与已有 `wiki/` 比较后，没有发现需要用户裁决的真实冲突：

- Apple 用“高质量播放模式”和“麦克风加播放模式”描述 macOS 现象；Microsoft 用 A2DP（蓝牙立体声播放模式）和 HFP（蓝牙通话模式）解释 Windows 传统蓝牙，描述层级不同但相互吻合。
- Microsoft 明确把 LE Audio 单独列出，并说明只有部分 Windows 11 电脑和设备组合能在使用麦克风时保持立体声；这不是对所有蓝牙耳机的普遍保证。
- Bluetooth SIG 当前规范目录页显示 A2DP 1.4.1 和 HFP 1.10 均为 Adopted（已采用）版本；这补充了规范版本信息，不改变本项目基于 Windows、macOS 和本机实测的现象判断。
- A2DP/HFP 的 Bluetooth SIG 定义、Microsoft 的系统行为说明和已有 LE Audio 资料处于不同抽象层级，没有形成结论冲突。
- 社区资料记录的是绕过或自动化切换输入设备的实践，不能替代官方协议能力说明。

后续新增文献仍必须先进入 `raw/`，再逐项检查本索引及相关主题文档；如果出现无法按版本、设备、系统或来源质量化解的冲突，保留双方证据并提交用户裁决。

# 蓝牙耳机麦克风与播放异常知识索引

## 这套资料解决什么问题

本索引服务于本项目要排查的问题：带麦克风的蓝牙耳机在播放期间被应用调用麦克风后，声音变空洞、失真、低码率、卡顿、静音，或恢复播放后仍未回到正常听感。

## 证据等级

- **官方直接事实**：Apple、Microsoft 或 Bluetooth SIG（蓝牙技术联盟）原文明确写出的行为、条件和限制。
- **实机实测事实**：本项目按设备身份分别记录设备参数、系统日志和用户操作结果；2026-07-17 06:00 前的 Bose 与 K03S 记录属于 `MAC-home01-MacBookAir`，之后明确标为 `MACMINI9,1-175AC621` 的记录属于 `MAC-home02-MacMini`。
- **来源支持的推论**：多个来源共同支持、且没有超出条件范围的解释。
- **尚未证实的推测**：需要额外抓取应用内部音频流或设备固件信息才能确认的内容。

## 阅读顺序

1. [传统蓝牙麦克风为何会让播放质量下降](01-传统蓝牙麦克风导致播放质量下降.md)
2. [蓝牙音频模式与参数变化](02-蓝牙音频模式与参数变化.md)
3. [macOS 与 Windows 的官方处理方式](03-macOS与Windows官方处理方式.md)
4. [LE Audio 与硬件链路解决方案](04-LE-Audio与硬件解决方案.md)
5. [MAC-home01-MacBookAir：Bose 与 K03S 实测对照](05-MAC-home01-MacBookAir-Bose与K03S实测对照.md)
6. [K03S 蓝牙与 2.4G 接收器对照案例](cases/2026-07-16-K03S蓝牙与2.4G对照.md)
7. [选择蓝牙 A 作为输入导致蓝牙 B 进入 HFP](06-选择蓝牙A输入导致蓝牙B进入HFP.md)
8. [REDMI 跨设备蓝牙输入输出联动案例（macOS 15.7.7 / 24G720 / MACMINI9,1-175AC621）](cases/2026-07-17-REDMI跨设备蓝牙输入输出联动.md)
9. [跨设备蓝牙 HFP 降级的解决方案边界](07-跨设备蓝牙HFP降级的解决方案边界.md)
10. [跨设备 HFP 候选解决方案调研案例（macOS 15.7.7 / 24G720 / MACMINI9,1-175AC621）](cases/2026-07-17-跨设备HFP候选解决方案调研.md)

## 原文目录

### 官方资料

- [Apple：Mac 连接蓝牙耳机时音质降低](../raw/apple/apple-macos-bluetooth-headphones-sound-quality.md)
- [Apple：在 Mac 上创建组合声音设备](../raw/apple/apple-audio-midi-aggregate-device.md)
- [Apple 开发者问答：HFP 双向输入输出路径](../raw/apple/apple-developer-forum-hfp-bidirectional-route.md)
- [Microsoft：传统蓝牙音频](../raw/microsoft/bluetooth-classic-audio.md)
- [Microsoft：通信场景下的音频格式能力](../raw/microsoft/communications-audio-format-capabilities.md)
- [Microsoft：蓝牙 LE Audio（低功耗蓝牙音频）](../raw/microsoft/bluetooth-low-energy-audio.md)
- [Bluetooth SIG：LE Audio](../raw/bluetooth-sig/le-audio.md)

### 社区资料

- [Hammerspoon：AirPods 自动切换到其他麦克风](../raw/community/hammerspoon-airpods-microphone.md)
- [Hacker News：CrystalClear Sound 讨论](../raw/community/hacker-news-crystalclear-sound.md)
- [AirPods Sound Quality Fixer：自动改回其他输入的项目说明](../raw/community/airpods-sound-quality-fixer-readme.md)
- [ToothFairy：禁用设备声音输入功能说明](../raw/community/toothfairy-disable-audio-input.md)
- [HIKKIE!：2026 年 7 月各系统 LE Audio 支持状况综述](../raw/community/hikkie-leaudio-ready-2026-07.md)

## 首次沉淀的冲突检查

本次新建 `knowledge/wiki/` 时，目录中没有已有知识文档，因此不存在需要覆盖或删除的旧结论。7 篇来源之间也没有形成需要用户裁决的真实冲突：

- Apple 用“高质量播放模式”和“麦克风加播放模式”描述 macOS 现象；Microsoft 用 A2DP（蓝牙立体声播放模式）和 HFP（蓝牙通话模式）解释 Windows 传统蓝牙，描述层级不同但相互吻合。
- Microsoft 明确把 LE Audio 单独列出，并说明只有部分 Windows 11 电脑和设备组合能在使用麦克风时保持立体声；这不是对所有蓝牙耳机的普遍保证。
- 社区资料记录的是绕过或自动化切换输入设备的实践，不能替代官方协议能力说明。

后续新增文献仍必须先进入 `raw/`，再逐项检查本索引及相关主题文档；如果出现无法按版本、设备、系统或来源质量化解的冲突，保留双方证据并提交用户裁决。

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

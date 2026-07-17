# macOS 与 Windows 的官方处理方式

## 结论

Apple 的官方处理方式是停止占用蓝牙耳机麦克风的应用，必要时先切到 Mac 内置扬声器再重新选择蓝牙耳机。Windows 传统蓝牙则会根据麦克风和通信流自动选择 HFP 或 A2DP，并在需要时重采样；Windows 11 的 LE Audio 可能在麦克风使用时保留立体声，但不是所有电脑和设备组合都支持。

## macOS：官方建议

Apple 原文给出的步骤是：

1. 退出使用蓝牙耳机内置麦克风的视频会议或聊天应用。
2. 确保系统设置没有停留在声音设置页面。
3. 如果音质仍然降低，从菜单栏控制中心的声音面板中先选择 Mac 内置扬声器，再重新选择蓝牙耳机。

Apple 的页面解释了现象和恢复动作，但没有承诺能让传统蓝牙耳机在使用自身麦克风时保持高质量立体声。

来源：[Apple 原文](../raw/apple/apple-macos-bluetooth-headphones-sound-quality.md)。

## Windows：传统蓝牙自动切换

Microsoft 写明，Windows 10 与 Windows 11 的端点表现不同，但共同点是：打开耳机麦克风会让传统蓝牙进入 HFP；关闭麦克风后系统尝试回到 A2DP。Windows 11 会将其他应用的音频重采样到当前 HFP 端点，例如把 48 kHz 播放适配到 8 kHz 或 16 kHz 通话端点。

这解释了“音乐应用仍显示播放，但耳朵听到低质量甚至无声”的可能性：系统和应用的播放状态不一定与蓝牙设备完成模式重建的时间完全同步。Microsoft 原文确认了自动重采样和模式选择，但没有为每个应用保证切换期间一定无缝。

来源：[Microsoft 传统蓝牙音频](../raw/microsoft/bluetooth-classic-audio.md)。

## Windows：LE Audio 的条件性能力

Microsoft 明确把 LE Audio 单独处理。部分 Windows 11 电脑可以在麦克风使用时继续立体声播放，但这取决于电脑蓝牙芯片、驱动、Windows 音频系统和耳机能力；不支持时仍可能变为单声道。不能仅看到耳机宣传“支持 LE Audio”就断定当前电脑一定能用到双向立体声。

来源：[Microsoft 通信格式说明](../raw/microsoft/communications-audio-format-capabilities.md) 和 [Microsoft LE Audio](../raw/microsoft/bluetooth-low-energy-audio.md)。

## 社区绕过方案

### Hammerspoon 自动切换输入

Mitch 的文章使用 Hammerspoon（macOS 自动化工具）监听默认输入设备变化；如果 macOS 把输入切到 AirPods，就把输入改回 USB 麦克风，并播放提示音。文章也保留了旧的轮询脚本和启动服务方法。

这是“耳机输出 + 其他设备输入”的自动化绕过，不是让传统蓝牙耳机同时提供高质量立体声和自身麦克风。

来源：[Hammerspoon 原文](../raw/community/hammerspoon-airpods-microphone.md)。

### CrystalClear Sound 讨论

Hacker News 的发帖人描述了同类问题，并介绍了一个自动避免 AirPods 被选为输入的 macOS 应用。讨论中包含 Apple 官方建议、自动化切换输入的做法、应用行为和价格等社区信息。它属于用户经验和产品讨论，不能作为协议能力或兼容性的独立证明。

来源：[Hacker News 原文及完整评论](../raw/community/hacker-news-crystalclear-sound.md)。

### 自动修复工具的共同边界

AirPods Sound Quality Fixer（自动把默认麦克风改回其他设备的工具）的项目说明与 Hammerspoon 方案一致：它强制把默认输入改为 Mac 内置或用户指定的其他麦克风。它能减少手工切换，但不能满足“继续使用蓝牙输入 A，同时让蓝牙输出 B 保持 A2DP”的要求。

ToothFairy（用于控制蓝牙连接和声音选择的工具）另有“禁止使用设备声音输入”的选项。其手册同时承认应用可能覆盖设置并重新启用低质量通话编码。本项目的输出 B 在麦克风未被选中时仍会跨设备降级，因此该功能只能复测，不能直接算作修复。

来源：[AirPods Sound Quality Fixer 项目说明](../raw/community/airpods-sound-quality-fixer-readme.md)、[ToothFairy 手册](../raw/community/toothfairy-disable-audio-input.md)。

### 组合声音设备的边界

Apple 官方说明，组合声音设备用于合并多个真实设备的通道、统一采样率、选择时钟源和进行时钟漂移修正。官方资料没有说明组合设备可以锁定蓝牙协议，因此不能只凭创建了逻辑设备就断言 B 不会进入 HFP。

来源：[Apple 组合声音设备原文](../raw/apple/apple-audio-midi-aggregate-device.md)。详细方案判断见[跨设备蓝牙 HFP 降级的解决方案边界](07-跨设备蓝牙HFP降级的解决方案边界.md)。

## 方案代价

| 方案 | 解决层级 | 代价或边界 |
| --- | --- | --- |
| 输入切到 Mac 内置或 USB 麦克风 | 改变使用条件 | 不能使用蓝牙耳机自身麦克风 |
| 语音结束后重新选择输出或输入 | 触发路由重建 | 可能仍有应用重建延迟，不能改变 HFP 能力 |
| 自动化强制选择其他输入 | 自动化绕过 | 会议软件可能不喜欢通话中途切换设备，仍需测试 |
| LE Audio 或 USB/2.4G 链路 | 改变底层能力或连接方式 | 需要验证电脑、驱动、耳机或接收器的完整组合 |
| 组合声音设备 | 待验证 | 官方只说明通道组合，没有协议隔离承诺 |
| 禁止使用输出 B 的麦克风 | 待验证的软件干预 | 本项目在 B 麦克风未选中时仍观察到降级 |

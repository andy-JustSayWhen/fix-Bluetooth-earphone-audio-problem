# LE Audio 与硬件解决方案

## 结论

LE Audio 不是传统蓝牙 A2DP/HFP 的另一个可随意点击的“编解码器选项”，而是运行在低功耗蓝牙无线电上的新音频体系。它有机会在使用麦克风时继续提供立体声，但是否真的可用取决于耳机、电脑蓝牙硬件、驱动、操作系统和音频配置共同支持。

如果目标是“同一副无线耳机同时使用自身麦克风，并保持正常音乐听感”，可靠路线只有两类：验证完整 LE Audio 组合确实提供双向立体声，或使用能把输入输出作为独立高质量端点呈现的 USB/2.4G 接收器。单凭耳机名称、蓝牙版本或系统设置里没有协议下拉菜单，都不能完成确认。

## 来源明确的 LE Audio 能力

- Bluetooth SIG 说明 Classic Audio 运行在 Bluetooth Classic 无线电，LE Audio 运行在 Bluetooth Low Energy 无线电。
- Bluetooth SIG 说明 LE Audio 引入 LC3（低复杂度通信编码器）以及单播、广播和 Auracast（蓝牙广播音频）等能力。
- Microsoft 的 Windows 资料说明，Windows 11 22H2（KB5026446）引入了该文档所述 LE Audio 支持路径；具体实现仍需要厂商音频驱动和蓝牙硬件配合。
- Microsoft 的通信格式资料说明，一些 Windows 11 电脑可以在 LE Audio 麦克风使用时保持立体声；其他组合可能只有单声道，或因用户设置变为单声道。

来源：[Bluetooth SIG 原文](../raw/bluetooth-sig/le-audio.md)、[Microsoft LE Audio 原文](../raw/microsoft/bluetooth-low-energy-audio.md)、[Microsoft 通信格式原文](../raw/microsoft/communications-audio-format-capabilities.md)。

## 如何判断一款耳机是否“支持 LE Audio”

本项目应采用三层证据，不把宣传语当成当前链路事实：

1. **产品能力证据**：厂商说明、说明书或蓝牙认证资料明确列出 LE Audio、BAP/TMAP/HAP、LC3 等对应能力。
2. **主机能力证据**：操作系统版本、电脑蓝牙芯片、驱动和厂商支持路径满足该系统的 LE Audio 条件。
3. **当前链路证据**：系统端点、诊断日志或厂商工具显示当前连接实际建立了 LE Audio 音频流，并记录当前输入输出格式。

只有第一层，最多说明耳机设计上可能支持；只有第三层，才能回答“这次播放是否实际用了 LE Audio”。本机 `system_profiler` 和音频端点采样率本身不能单独证明 LE Audio 或 LC3 已启用。

## 2.4G 接收器为何可能有效

2.4G 接收器通常以 USB 音频设备身份呈现给电脑，避开了 macOS 或 Windows 对传统蓝牙 A2DP/HFP 端点的切换限制。本项目 K03S 的 2.4G 实测中，系统看到的是 USB 设备，输出约 48 kHz/双声道，输入约 48 kHz/单声道，且用户没有听到异常。

这项实测证明的是“该接收器链路在本机能同时提供稳定的输入输出参数”，不是“2.4G 就等于 LE Audio”。两者的无线协议和证据路径不同。

## 不能承诺的内容

- 不能仅凭“支持 Bluetooth 5.x”判断支持 LE Audio；Bluetooth SIG 页面把 Classic Audio 和 LE Audio 分为不同无线电与体系。
- 不能仅凭 Windows 或 macOS 设置界面没有协议切换项，判断设备不支持 LE Audio；系统可能自动协商或把协议细节隐藏在驱动层。但如果系统没有提供当前链路诊断，就必须把协议状态标为未确认。
- 不能把 LE Audio 的理论能力直接套到本机 Bose；本机当前证据显示的是传统蓝牙 HFP/A2DP 服务与 `tsco`/`tacl` 传输日志，尚未证明 Bose 在这台 Mac 上建立过 LE Audio 流。

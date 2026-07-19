# HFP 与 A2DP 链路建立及恢复接口边界

## 结论

“把输出采样率直接请求为 44.1 kHz”不是从 HFP 恢复到 A2DP 的协议级命令。采样率是当前音频端点和传输链路协商后的表现；当系统只暴露 HFP 端点时，请求高采样率既不能释放 HFP 音频连接，也不能建立 A2DP 媒体传输。

## 直接证据

1. Bluetooth SIG 的 HFP 测试规范把 eSCO 双向音频连接的建立和释放列为独立过程，并要求 HF 与 AG 都能移除已有音频连接。见 [HFP 1.8 音频连接原文](../raw/bluetooth-sig/hfp-1.8-audio-connection.md)。
2. Apple 将常见蓝牙连接任务交给系统高级管理器；公开接口描述了设备连接、服务发现及通道访问，但本次没有找到强制系统音频配置选择 A2DP 或只释放系统 HFP 音频连接的公开调用。见 [macOS 蓝牙协议栈与公开接口边界](../raw/apple/apple-bluetooth-stack-and-audio-profile-api.md)。
3. BlueZ 的实现记录分别处理 A2DP 的端点配置、传输获取和 HFP 的 SCO/eSCO 连接，说明两者不是用修改采样率相互切换。见 [BlueZ 实现证据](../raw/community/bluez-a2dp-hfp-transport-evidence.md)。

## 适用范围

- 协议层结论适用于传统蓝牙 HFP 与 A2DP 的分层理解。
- macOS 接口结论仅表述“当前查到的公开文档没有提供”，不排除系统内部或未公开接口具备控制能力。
- BlueZ 是 Linux 实现，只作为第三方开发者实现参考，不能直接移植为 macOS 方案。

## 限制与反例

- 设备重连会重建基础连接及其上层服务，因此可能间接恢复 A2DP，但它不是精确的“只释放 HFP”操作。
- 重新提交默认输出可能促使系统重新评估路由，但没有协议资料证明它必然释放 HFP；必须用实际活动传输和输出参数验证。
- 保持同一传统蓝牙设备的麦克风处于实际使用状态时，不能把高采样率写入当作绕过 HFP 的办法。

## 可行方案及其代价

1. 先结束已确认的麦克风读取，等待系统自行释放 HFP 音频连接，扰动最低。
2. 重新提交当前输出路由，作为促使系统重新评估的候选动作；它不是确证的协议级恢复。
3. 重启系统声音服务会影响全机声音，且仍需验证。
4. 断开并重连目标设备能完整重建连接，体感最差，只作为最后兜底。
5. 请求高采样率只允许用作 A2DP 已恢复后的格式请求或验证，不再列为恢复动作。

## 来源

- [Bluetooth SIG HFP 1.8 音频连接](../raw/bluetooth-sig/hfp-1.8-audio-connection.md)
- [Apple macOS 蓝牙协议栈与公开接口](../raw/apple/apple-bluetooth-stack-and-audio-profile-api.md)
- [BlueZ A2DP 与 HFP 传输实现证据](../raw/community/bluez-a2dp-hfp-transport-evidence.md)

## 本项目关联案例

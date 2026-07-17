# 2026-07-17 MAC-home02-MacMini SoundSource 服务运维实测

## 设备身份

- 机器：`MAC-home02-MacMini`
- 机器标识：`MACMINI9,1-175AC621`
- 系统：macOS 15.7.7 / 24G720
- SoundSource：6.0.3
- ARK：13.1.2

本案例只适用于上述电脑，不与 `MAC-home01-MacBookAir` 的历史状态合并。

## 已核实的安装结构

- 前台程序：`/Applications/SoundSource.app/Contents/MacOS/SoundSource`
- 后台进程：`arkaudiod --agent`
- 后台任务：`com.rogueamoeba.arkaudiod`
- 后台任务文件：`/Library/LaunchAgents/com.rogueamoeba.arkaudiod.plist`
- 后台任务包含持续保活设置。
- 驱动：`/Library/Audio/Plug-Ins/HAL/ARK.driver`
- 驱动标识：`com.rogueamoeba.ARK.driver`
- 驱动签名者：Rogue Amoeba Software, Inc.

## 已实测事实

此前只退出 SoundSource 前台时，`arkaudiod` 和 ARK 驱动仍驻留。因此，“退出 SoundSource”不能作为排除第三方声音环境的充分证据。

本机曾执行完整对照：停止前台和后台、把 ARK 驱动移出正式声音驱动目录、重建系统声音服务。之后又把同一驱动移回、验证签名、重建系统声音服务并恢复 SoundSource。恢复后：

- SoundSource 前台运行；
- `arkaudiod --agent` 后台运行；
- ARK 驱动位于正式目录且签名有效；
- 默认输入仍为 `16 kHz / 单声道`；
- 默认输出仍为 `44.1 kHz / 双声道`。

因此，组件恢复本身没有立即把设备带入 HFP。是否发生蓝牙模式异常，仍需实际触发麦克风读取并观察退出过程。

## 2026-07-17 22:33 当前监测快照

- SoundSource 前台进程号：14536
- `arkaudiod` 后台进程号：11702
- 后台任务状态：已加载并启用
- ARK 驱动：位于正式目录
- 官方详细日志：`/Users/mac/Desktop/SoundSource debug log 07-17 223033.log`
- 日志在复核时约 1.5 MB，仍持续写入

进程号只属于该次启动，重启程序后会变化，不能写死进自动化判断。

## 本案例支持的结论

1. 完整停用必须覆盖前台、后台保活任务、驱动和系统声音服务重载。
2. 完整恢复必须验证驱动签名、后台任务、前台进程及实际声音路由。
3. SoundSource 官方日志与 macOS 统一日志应同时保留，才能把应用内部活动和系统声音链路对齐。
4. SoundSource 组件存在不等于它就是异常原因；仍需用停用前后、同一操作条件下的对照实验确认。

## 关联文档

- [SoundSource 服务运维主文档](../00-SoundSource服务运维.md)
- [MAC-home02-MacMini 日志能力启用现场](../../cases/2026-07-17-MAC-home02日志启用现场.md)
- [Rogue Amoeba：SoundSource 调试日志](../../../raw/community/rogue-amoeba-soundsource-debug-logs.md)

# Apple：macOS 蓝牙与音频诊断日志入口

## 来源信息

- 发布机构：Apple Inc.
- 原始页面：[Profiles and Logs - Feedback Assistant](https://developer.apple.com/feedback-assistant/profiles-and-logs/?platform=macos)
- 相关下载：[More Downloads - Apple Developer](https://developer.apple.com/download/all/?q=Additional%20Tools%20for%20Xcode)
- 获取日期：2026-07-17
- 原文语言：英文
- 保存范围：本项目只归档上述页面中与 macOS 蓝牙、音频异常和通用系统诊断直接相关的条目；页面还包含大量与本项目无关的应用和系统组件配置，未纳入本地副本。
- 清洗说明：已删除导航栏、登录区、页脚和无关配置条目；产品名称、配置名称、下载名称、用途和限制保持原意。配置安装界面的有效期与隐私说明来自本机实际安装时显示的 Apple 签名内容。

---

## Profiles and Logs

Apple 将用于问题反馈的诊断能力分为配置文件、说明文档和按需生成的诊断包。与本项目直接相关的 macOS 条目如下。

### Audio Glitch Trace

- 提供配置文件和说明文档。
- 用途：在发生可听见的音频异常时生成系统追踪文件，供排查干扰性声音问题。
- 配置说明明确表示不保存音频内容。
- 本机安装界面说明：配置在 7 天后失效；生成的追踪文件由用户检查，只有用户手动发送时才会提交给 Apple。

### Bluetooth

- 提供配置文件和说明文档。
- 用途：为 Bluetooth 与 Wireless Proximity 开启完整日志。
- 本机安装界面说明：配置在 3 天后失效；日志可能包含通话历史、共享到蓝牙设备的通知内容、配对设备名称、附近或已连接设备标识、播放元数据和部分附件通信内容。键盘、鼠标和触控板的通信载荷不记录。
- 配置只兼容 macOS 12 或更新版本。

### Console Logs

- 提供说明文档。
- 对应 macOS 统一日志系统，可查看和导出系统及应用写入的日志。

### Crash Logs

- 提供说明文档。
- 对应程序崩溃后产生的诊断报告。

### Coredump

- 提供说明文档。
- 用于保存进程崩溃时的内存现场。是否实际生成还取决于系统和进程限制，不能仅凭系统支持就认定已经启用。

### Sysdiagnose

- 提供说明文档。
- 属于按需生成的整机诊断包，不是持续后台采集。

## Additional Tools for Xcode 26.6

Apple 的稳定版附加工具包列出了 `PacketLogger`。该工具用于记录和查看蓝牙控制器数据包。工具被安装并打开不等于已经产生抓包文件；必须实际开始一次捕获并保存结果。

## 来源边界

- Apple 页面证明这些诊断入口由 macOS 或 Apple 工具链支持，但不证明本机已经启用或已经生成数据。
- 配置文件的有效期、安装层级和当前状态必须在目标机器上单独核验。
- `PacketLogger` 只能补充蓝牙包级证据，不能替代系统音频端点、采样率、声道和当前路由检查。

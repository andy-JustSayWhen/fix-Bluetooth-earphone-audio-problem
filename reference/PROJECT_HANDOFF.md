# 项目交接：2026-07-18 蓝牙音量与 HFP 排障

## 代码与分支

| 项目 | 值 |
| --- | --- |
| 仓库 | `andy-JustSayWhen/fix-Bluetooth-earphone-audio-problem` |
| 交接分支 | `agent/bluetooth-audio-web-tool` |
| 主要实验主机 | `MAC-home02-MacMini`，Mac mini M1，macOS 15.7.7（`24G720`） |
| 目标设备 | `Redmi电脑音箱-3899`，地址 `50:88:11:07:63:DA` |

## 交接前实时状态

2026-07-18 交接前再次读取：

| 项目 | 当前状态 |
| --- | --- |
| 微信输入法 | 正在运行，进程号 `65168` |
| Redmi 蓝牙音箱 | 未出现在当前音频或蓝牙活动设备列表，即当时未连接 |
| 默认输入 | `MOONDROP Rays`，USB，48 kHz、双声道 |
| 默认输出 | Mac mini 扬声器，48 kHz、双声道 |

注意：这是交接时现场，不是上面最后一次有效实验的终态。

## 当前代码状态

| 内容 | 状态 |
| --- | --- |
| 断开整个蓝牙连接的辅助程序 | 已写入并成功编译，但本轮未接入完整恢复流程 |
| 仅请求断开 SCO 通话声音连接的辅助程序 | 已写入并成功编译，但本轮未在真实 HFP 现场完成验收 |
| 自动测试 | 25 项全部通过 |
| 前端刷新与设备切换速度 | 本次交接前服务未运行，没有重做实时速度验收；规范中保留的上一次实测数据不应冒充本轮新验证 |

## 关键文档

## 2026-09-15 换机记录（Windows 主机）

以下事实来自新的 Windows 开发机，与上方 macOS 主机 `MAC-home02-MacMini` 是不同设备，不得混用两机的实测数据：

| 项目 | 值 |
| --- | --- |
| 新主机 | Windows 11 Pro，Node v24.12.0（`C:\Program Files\nodejs\node.exe`） |
| 换机后首个故障 | 服务启动后页面报 `spawn powershell.exe ENOENT`，设备读取失败 |
| 故障原因 | 该机系统 PATH 不含 `C:\Windows\System32\WindowsPowerShell\v1.0\`，且注册表机器级 PATH 中含字面量 `!SYS_PATH!`、`!USER_PATH!` 占位符（疑似被环境变量管理工具改写）；旧电脑 PATH 正常，因此裸命令名调用在旧机可用、新机失败 |
| 修复 | 新增 `tools/bluetooth-audio-mode-checker/shared/windows-powershell/`，按 `SystemRoot` 绝对路径定位 powershell.exe，替换全部 6 处裸命令名调用；规则见 [Windows适配.md](SPEC/Windows适配.md) |
| 本机缺失数据 | `artifacts/` 目录整体不存在（旧机诊断产物不随代码提交），依赖它的历史回放测试在本机自动跳过 |
| 本机测试结果 | 172 项：168 通过、0 失败、4 跳过（3 项 macOS 专属 + 1 项证据文件缺失） |
| 系统级建议（未执行） | 本机系统 PATH 异常建议人工修复：机器级 PATH 应补回 `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\` 等默认项；此为系统级改动，Agent 不擅自执行 |

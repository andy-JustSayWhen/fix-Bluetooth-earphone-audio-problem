# 如何快速、完整地停用、恢复和监测 SoundSource

## 目标与适用范围

本文用于在 macOS 上建立可重复的 SoundSource 对照环境，适合判断 SoundSource 是否参与声音路由异常。命令以本项目实测的 SoundSource 6.0.3、ARK 13.1.2 和 macOS 15.7.7 为基线；其他版本执行前必须重新核对路径和任务标识。

本文所说的“完整停用”不等于卸载，也不删除应用、用户配置或历史日志。它表示：SoundSource 前台退出、ARK（SoundSource 的声音路由后台）停止、ARK 驱动移出系统当前加载目录，并让 macOS 重建声音服务。

## 三种状态不能混淆

| 状态 | 前台应用 | `arkaudiod` 后台 | `ARK.driver` 驱动 | 可否作为纯系统对照 |
|---|---|---|---|---|
| 只退出应用 | 停止 | 可能仍运行 | 仍加载 | 不可以 |
| 停止应用与后台 | 停止 | 停止 | 仍加载 | 不够干净 |
| 完整停用 | 停止 | 停止 | 移出加载目录并重载声音服务 | 可以 |

后台任务配置包含持续保活设置，所以只结束 `arkaudiod` 进程可能会被系统立即重新拉起。必须先卸载后台任务，再处理进程。

## 操作前快照

先记录当前输入输出和 SoundSource 组件状态，便于恢复后对照：

```zsh
date
system_profiler SPAudioDataType
pgrep -alf '[S]oundSource|[a]rkaudiod' || true
launchctl print "gui/$(id -u)" 2>/dev/null | rg -i 'rogueamoeba|arkaudio|soundsource' || true
find '/Library/Audio/Plug-Ins/HAL' '/Library/Audio/Plug-Ins/HAL Disabled' \
  -maxdepth 2 -iname '*ARK*' -print 2>/dev/null
```

## 快速完整停用

以下操作会让依赖 ARK 的声音处理功能暂时失效，并会短暂重建系统声音服务。执行前应停止重要录音或通话。

### 1. 正常退出前台

如果正在采集 SoundSource 官方调试日志，正常退出也会结束并保存本轮日志：

```zsh
osascript -e 'tell application "SoundSource" to quit'
```

### 2. 卸载保活后台并结束残留进程

```zsh
launchctl bootout "gui/$(id -u)" \
  /Library/LaunchAgents/com.rogueamoeba.arkaudiod.plist 2>/dev/null || true
pkill -x arkaudiod 2>/dev/null || true
```

### 3. 把驱动移出当前加载目录

只移动，不删除，以便原样恢复：

```zsh
sudo mkdir -p '/Library/Audio/Plug-Ins/HAL Disabled'
sudo mv '/Library/Audio/Plug-Ins/HAL/ARK.driver' \
  '/Library/Audio/Plug-Ins/HAL Disabled/ARK.driver'
```

如果目标目录已经存在同名驱动，必须停止操作并人工核对，不能覆盖。

### 4. 重建系统声音服务

```zsh
sudo killall coreaudiod
```

`coreaudiod`（macOS 的核心声音后台）会由系统自动重新拉起。执行后声音可能短暂中断，应用可能需要重新建立输出通道。

### 5. 验证完整停用

```zsh
pgrep -alf '[S]oundSource|[a]rkaudiod' || true
launchctl print "gui/$(id -u)/com.rogueamoeba.arkaudiod" 2>&1
test ! -e '/Library/Audio/Plug-Ins/HAL/ARK.driver' && echo 'ARK_ACTIVE_DRIVER_ABSENT'
test -e '/Library/Audio/Plug-Ins/HAL Disabled/ARK.driver' && echo 'ARK_DRIVER_PRESERVED'
system_profiler SPAudioDataType | rg -i 'ARK|SoundSource' || true
```

验收必须同时满足：没有 SoundSource 进程、没有 `arkaudiod` 进程、后台任务未加载、正式驱动目录中没有 ARK、停用目录中仍保存原驱动。只满足其中一部分不能称为完整停用。

## 快速完整恢复

### 1. 把原驱动移回正式目录

```zsh
sudo mv '/Library/Audio/Plug-Ins/HAL Disabled/ARK.driver' \
  '/Library/Audio/Plug-Ins/HAL/ARK.driver'
```

### 2. 验证驱动身份和签名

```zsh
codesign --verify --deep --strict --verbose=2 \
  '/Library/Audio/Plug-Ins/HAL/ARK.driver'
codesign -dv --verbose=2 \
  '/Library/Audio/Plug-Ins/HAL/ARK.driver' 2>&1 | \
  rg 'Identifier|Authority|TeamIdentifier'
```

本机实测的驱动标识为 `com.rogueamoeba.ARK.driver`，签名者为 Rogue Amoeba。若校验失败，不继续加载。

### 3. 重建声音服务并恢复后台任务

```zsh
sudo killall coreaudiod
launchctl bootstrap "gui/$(id -u)" \
  /Library/LaunchAgents/com.rogueamoeba.arkaudiod.plist 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/com.rogueamoeba.arkaudiod"
open -a SoundSource
```

### 4. 验证恢复

```zsh
pgrep -alf '[S]oundSource|[a]rkaudiod'
launchctl print "gui/$(id -u)/com.rogueamoeba.arkaudiod" | \
  rg 'state =|pid =|program =|path ='
test -e '/Library/Audio/Plug-Ins/HAL/ARK.driver' && echo 'ARK_ACTIVE_DRIVER_PRESENT'
system_profiler SPAudioDataType | rg -i 'ARK|SoundSource' || true
```

最后还要实际播放声音，并核对默认输入、默认输出、采样率和声道。进程恢复不等于声音路由一定恢复。

## 持续监测服务状态

下面的循环每两秒打印一次前台、后台、任务和驱动状态，按 `Control-C`（同时按下 Control 键和 C 键来停止当前命令）结束：

```zsh
while true; do
  clear
  date
  echo '=== processes ==='
  pgrep -alf '[S]oundSource|[a]rkaudiod' || echo 'none'
  echo '=== launch job ==='
  launchctl print "gui/$(id -u)/com.rogueamoeba.arkaudiod" 2>/dev/null | \
    rg 'state =|pid =|program =|path =' || echo 'not loaded'
  echo '=== driver ==='
  find '/Library/Audio/Plug-Ins/HAL' '/Library/Audio/Plug-Ins/HAL Disabled' \
    -maxdepth 2 -iname '*ARK*' -print 2>/dev/null
  sleep 2
done
```

## 持续监测日志

### SoundSource 官方调试日志

先按[官方调试日志说明](../../raw/community/rogue-amoeba-soundsource-debug-logs.md)开启 SoundSource、ARK 和 Sampler（定时保存进程运行现场的采样工具），再执行：

```zsh
debug_log=$(ls -t "$HOME"/Desktop/SoundSource\ debug\ log\ *.log 2>/dev/null | head -1)
test -n "$debug_log" && tail -F "$debug_log"
```

### macOS 统一日志

```zsh
/usr/bin/log stream --style compact --level debug \
  --predicate 'process == "SoundSource" OR process == "arkaudiod"'
```

应用内部日志用于观察 SoundSource 和 ARK 自身活动；统一日志用于观察它们与系统服务的交互。两者都不能单独证明蓝牙当前处于 A2DP 或 HFP，还要结合活动声音端点、采样率、声道及蓝牙链路记录。

## 快速判定表

| 现象 | 判定 |
|---|---|
| 前台已退出，但 `arkaudiod` 仍在 | 没有完整停用 |
| 后台进程结束后立刻重现 | 保活任务仍加载 |
| 进程都不在，但 `ARK.driver` 仍在正式目录 | 驱动仍可能参与系统声音环境 |
| 驱动已移走，但未重载 `coreaudiod` | 当前声音服务可能仍保留旧加载状态 |
| 恢复后只有前台，没有 `arkaudiod` | 后台任务没有正确恢复 |
| 服务恢复但应用无声 | 继续检查默认路由和应用输出通道，不能只看进程 |

## 安全边界

- 不删除 `/Applications/SoundSource.app`、用户配置、许可证或历史日志。
- 不覆盖停用目录中的同名驱动。
- 不把强制结束进程当作第一步；正在采集官方日志时先正常退出。
- 不在录音、会议或重要播放期间重载系统声音服务。
- 不把本机路径和标识直接推广到其他版本；先重新探测。

## 关联案例与来源

- [MAC-home02-MacMini 实测案例](cases/2026-07-17-MAC-home02-SoundSource服务运维实测.md)
- [MAC-home02-MacMini 日志能力启用现场](../cases/2026-07-17-MAC-home02日志启用现场.md)
- [macOS 蓝牙与音频日志能力矩阵](../09-macOS蓝牙与音频日志能力矩阵.md)
- [Rogue Amoeba：SoundSource 调试日志](../../raw/community/rogue-amoeba-soundsource-debug-logs.md)

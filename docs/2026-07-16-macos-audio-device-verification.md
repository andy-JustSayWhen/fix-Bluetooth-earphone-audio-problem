# macOS 当前音频设备核对记录

## 核对时间

2026-07-16 00:00:47（东八区）。

## 核对目的

确认 macOS 的系统默认音频路由、QQ音乐实际播放路由、音频输入和系统提示音输出，分别与“系统设置”应用和顶部菜单栏显示的设备是否一致。

## 实时系统查询

使用 macOS 自带的 `system_profiler SPAudioDataType -json` 查询当前音频设备状态。

| 路由 | 当前设备 | 连接类型 | 采样率 | 查询依据 |
| --- | --- | --- | --- | --- |
| 系统默认普通音频输出 | Redmi 电脑音箱 | USB | 48 kHz | `coreaudio_default_audio_output_device: spaudio_yes` |
| 音频输入 | Bose QC Headphones | 蓝牙 | 16 kHz | `coreaudio_default_audio_input_device: spaudio_yes` |
| 系统提示音输出 | Bose QC Headphones | 蓝牙 | 44.1 kHz | `coreaudio_default_audio_system_device: spaudio_yes` |

这组查询只说明系统默认路由，不代表每个应用的实际播放路由。系统默认普通输出是 Redmi 电脑音箱，麦克风输入是 Bose QC Headphones，系统提示音输出是 Bose QC Headphones。

## QQ音乐实际播放路由修正

用户确认：此时正在播放的 QQ音乐声音实际从 `Bose QC Headphones` 听到，而且该设备出现了项目 README 所描述的音质异常。这个实听结果是应用实际输出的直接证据，优先级高于“系统默认普通输出”字段。

本机同时运行了 SoundSource（按应用分别指定音频输出的工具）。其配置文件中存在 QQ音乐专属条目：

- 应用标识：`com.tencent.QQMusicMac`
- 应用名称：QQ音乐
- QQ音乐条目保存过的输出设备：`Redmi 电脑音箱`、`Bose QC Headphones`
- QQ音乐条目的选择状态为 `selected = 2`，说明它不是一个没有任何应用级路由记录的普通条目
- 配置文件：`~/Library/Application Support/SoundSource/Sources.plist`

这与“系统默认输出是 Redmi，但 QQ音乐实际从 Bose 播放”的现象相符：QQ音乐存在应用级输出路由，不能只看系统默认输出判断它实际送到哪里。SoundSource 配置本身证明了应用级路由记录存在，最终的当前播放设备则由用户当时的实听结果确认。

## 用户界面截图观察

### 系统设置应用

截图中可以直接看到：

- “播放声音效果的设备”显示为 `Bose QC Headphones`。
- “输出”列表中高亮的是 `Redmi 电脑音箱`。
- “输入”标签页没有展开，因此不能仅凭这张截图断言系统设置应用中输入设备的高亮项。

证据图片：[系统设置声音页面](evidence/macos-sound-settings.png)

### 顶部菜单栏声音面板

截图中可以直接看到：

- “输出”区域中，`Redmi 电脑音箱`使用蓝色图标，表示当前选中。
- “输入”区域中，`Bose QC Headphones`使用蓝色图标，表示当前选中。

证据图片：[顶部菜单栏声音面板](evidence/macos-menu-bar-sound.png)

## 一致性结论

| 对比项 | 实时系统状态 | 界面显示 | 是否一致 |
| --- | --- | --- | --- |
| 系统默认普通输出 | Redmi 电脑音箱 | 系统设置“输出”高亮 Redmi；顶部菜单栏输出高亮 Redmi | 是 |
| QQ音乐实际播放输出 | Bose QC Headphones | 用户实听为 Bose；SoundSource 保存了 QQ音乐的应用级输出路由 | 与系统默认输出不同，属于应用级路由 |
| 音频输入 | Bose QC Headphones | 顶部菜单栏输入高亮 Bose | 是 |
| 系统提示音输出 | Bose QC Headphones | 系统设置顶部“播放声音效果的设备”显示 Bose | 是 |
| 系统设置中的输入高亮项 | Bose QC Headphones | 提供的截图没有展示“输入”标签页内容 | 无法从截图直接核对 |

因此，上一版记录把“系统默认普通输出”误写成了“普通播放声音实际输出”，结论过度延伸，现已修正。当前真正的状态是：系统默认普通输出为 Redmi，但 QQ音乐实际输出为 Bose；这不是简单的前端界面显示错误，而是系统默认路由与应用级路由不同。

## 对蓝牙耳机音质异常排查的意义

Bose QC Headphones 当前承担音频输入，而且输入采样率是 16 kHz；它同时承担系统提示音输出，QQ音乐也实际从 Bose 播放。目标蓝牙耳机同时承担播放和麦克风输入时，应用可能触发蓝牙通话模式，从而出现空洞、失真、低码率、传输不稳定或没有声音。你已经确认此时存在音质异常，因此后续排查重点应放在 QQ音乐的应用级输出路由、Bose 麦克风是否被占用，以及蓝牙设备是否切换到低质量通话链路。

后续遇到“声音空洞、失真、码率很低、传输不稳定或没有声音”时，应同时记录：

1. 系统默认普通播放输出是什么设备。
2. SoundSource 或其他音频路由工具是否为出问题的应用设置了专属输出。
3. 出问题的应用实际从哪个设备播放，不能只看系统设置里的默认输出。
4. 系统输入是否启用了目标蓝牙耳机麦克风。
5. 出问题瞬间目标蓝牙设备的采样率和连接状态。

## 核对限制

本次图形界面自动读取没有在本机返回；界面部分依据用户提供的两张截图判断，系统设备部分依据同一台机器在上述时间点的实时 `system_profiler` 查询判断。两类证据的时间可能存在极短间隔，因此如果设备在截图后被切换，应重新执行查询并重新截图。

## 图形界面读取故障修复记录

本次读取 QQ音乐界面时，Computer Use（电脑操控后台组件）的 `get_app_state` 连续超时。按照 Obsidian 中已有的同类修复方法，已完成：

- 停止残留的 `SkyComputerUseService` 和客户端进程。
- 清理通信套接字与锁文件。
- 将相关缓存备份到 `/Users/mac/Library/Application Support/CodexComputerUseRepair-20260716-0007`。
- 运行当前版本的官方安装器并返回 `OK: Installed`。

修复后系统服务已重新建立通信套接字，但当前宿主应用中的通信链路仍未自愈，QQ音乐界面读取仍需重启 ChatGPT/Codex 宿主应用或新开线程后再验收。系统默认路由、SoundSource 配置和用户实听结果不受此界面读取故障影响。

## 修复后对照变量：QQ音乐仍选 Bose，但音频已无异常

核对时间：2026-07-16 00:22:03（东八区）。

用户在 SoundSource 中将 QQ音乐的“Redirect Audio To”改为 `No Redirect`，即不再由 SoundSource 为 QQ音乐单独改道。修改后，QQ音乐自己的设置页面仍保持：

| 变量 | 当前值 |
| --- | --- |
| QQ音乐输出设备 | Bose QC Headphones |
| QQ音乐输出策略 | 跟随系统默认配置 |
| QQ音乐独占输出 | 未开启 |
| QQ音乐支持采样率 | 16.0k、44.1k |
| QQ音乐缓冲大小 | 512 |
| QQ音乐 DSD 传输 | 设备不支持切换 DSD 传输模式 |
| SoundSource 的 QQ音乐改道 | No Redirect |
| SoundSource 系统输出 | Bose QC Headphones |
| SoundSource 系统输入 | Bose QC Headphones |
| SoundSource 系统提示音 | Bose QC Headphones |
| 用户实听结果 | Bose 仍是播放设备，但音频异常消失 |

同一时间点再次查询系统音频状态，Bose QC Headphones 同时被标记为：

- 系统默认普通输出。
- 系统默认输入。
- 系统提示音输出。

这说明修复后状态与之前发生了两个重要变化：

1. SoundSource 的 QQ音乐应用级改道从此前存在的路由状态变为 `No Redirect`。
2. 系统默认普通输出从此前的 Redmi 电脑音箱变为 Bose QC Headphones。

QQ音乐自己的输出设备在前后都保持为 Bose，因此目前不能把“音频恢复正常”只归因于某一个变量。当前最可靠的记录是：QQ音乐仍播放到 Bose；SoundSource 不再单独改道；系统普通输出也已与 Bose 对齐；最终实听无异常。

证据图片：

- [SoundSource 中 QQ音乐为 No Redirect](evidence/soundsource-qqmusic-no-redirect.png)
- [QQ音乐设置中输出设备为 Bose](evidence/qqmusic-output-bose.png)

## 下一步可控对照

若要确定真正起作用的变量，应一次只改变一个条件：保持 SoundSource 为 `No Redirect`、QQ音乐保持“跟随系统默认配置”、输入保持 Bose，然后分别把系统默认普通输出切换到 Bose 和 Redmi，播放同一首歌并记录是否复现异常。本记录暂不自动切换设备，只保存当前变量和结果。

# Rogue Amoeba：SoundSource 调试日志

## 来源信息

- 发布者：Rogue Amoeba
- 来源性质：SoundSource 官方支持文档
- 原文：<https://rogueamoeba.com/support/knowledgebase/?product=SoundSource&showArticle=Misc-DebuggingWindow>
- 原文：<https://www.rogueamoeba.com/support/knowledgebase/?product=SoundSource&showArticle=Misc-CollectingLogs>
- 获取日期：2026-07-17
- 原文语言：英文

## 清洗说明

保留与调试窗口、日志类别、复现和保存步骤有关的内容；省略页面导航、产品推广及与本次调查无关的通用支持入口。以下为忠实中文整理，不把本机实测结果混入官方原文事实。

## 清洗后的内容

SoundSource 提供专门的调试窗口。打开帮助菜单时按住 Option（显示额外菜单项的修饰键），原来的联系支持入口会变为“退出并以调试方式重新启动”。

调试窗口可以分别启用三类记录：

- SoundSource：记录应用自身的详细活动。
- ARK（SoundSource 的声音路由后台）：记录声音处理和路由后台的详细活动。
- Sampler（定时保存进程运行现场的采样工具）：在记录期间收集进程运行现场。

官方收集流程是：只启用调查所需的记录，完成设置后复现问题，然后退出 SoundSource。退出操作会结束本轮记录，并把调试日志保存到桌面。调试窗口中的隐藏设置和恢复出厂设置属于其他用途，不是启用日志的必要步骤。

## 在本项目中的用途

这组应用内部日志用于补充 macOS 统一日志：前者观察 SoundSource 与 ARK 自身的处理和路由活动，后者观察系统声音服务与蓝牙链路。两者不能互相替代。

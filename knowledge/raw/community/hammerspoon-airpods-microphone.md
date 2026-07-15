<!-- 来源信息区：本区不是原文正文。 -->

- 来源机构或作者：Mitch's Blog
- 原始网址：https://www.dermitch.de/post/macos-force-microphone-when-using-airpods/
- 发布或更新日期：08.06.2023；updated 23.07.2023
- 获取日期：2026-07-16
- 原文语言：English
- 清洗说明：网页导航、广告、脚本、重复页眉页脚和其他页面界面噪音已清除；正文内容保留。
- 图片或附件：本页没有需要单独归档的二进制图片或附件。

---

# macOS: Auto-switch to a different microphone when using AirPods

08.06.2023 updated 23.07.2023 [macOS](/categories/macos/) 2562 words

I work fully remote and spend a lot of my day in videocalls. Over the time, I've created a setup that works quite well for me:

- Apple AirPods as headphones, which allow me to concentrate better on calls than speakers
- A proper boom microphone for great voice quality

While it works quite well, there is a slight annoyance: Every time macOS connects the AirPods, they automatically become the microphone as well, even though they have a worse quality. Also, using AirPods as pure speakers also increases their sound quality.

In this post, I'd like to show the small solution I built to solve this for me.

# Using Hammerspoon

[Hammerspoon](https://www.hammerspoon.org/) is a useful tool for macOS, which allows you to write desktop automations using Lua scripts.

Using the following script, I enforce using my USB microphone every time macOS changes it to the AirPods. It also plays a sound for me as indicator that the settings are correct now, as some software (**cough** Microsoft Teams **cough**) doesn't like it, when these settings are changed during calls.

[autoswitch-microphone/autoswitch-microphone.lua](/code/autoswitch-microphone/autoswitch-microphone.lua)


```
--
-- Hammerspoon Script to enforce the audio input.
--
-- Useful documentation:
--   https://www.hammerspoon.org/docs/hs.audiodevice.html
--   https://www.hammerspoon.org/docs/hs.audiodevice.watcher.html
--

local MICROPHONE_DEVICE_NAME = "USB Condenser Microphone"

local log = hs.logger.new('init','debug')
log.i('Initializing')

function audioDeviceCallback(event)
    log.f('audioDeviceCallback: "%s"', event)
    if (event == "dIn ") then -- That trailing space is not a mistake
        local defaultInputDevice = hs.audiodevice.defaultInputDevice()
        log.f("Input device has changed to %s", defaultInputDevice)

        local microphone = hs.audiodevice.findDeviceByName(MICROPHONE_DEVICE_NAME)
        if (microphone ~= nil) then
            log.i("Setting microphone to be the default again")
            microphone:setDefaultInputDevice()

            local sound = hs.sound.getByName("Funk")
            sound:play()
        else
            log.w("Microphone is not connected!")
        end
    end
end

hs.audiodevice.watcher.setCallback(audioDeviceCallback)
hs.audiodevice.watcher.start()

log.i('Initialized!')
```

To use it, copy the script above into your `~/.hammerspoon/init.lua` and reload the config. Don't forget to change the device name, you can find it in the system settings.

# The old version

You can find the first version I originally wrote below, which was written using bash and a command line tool.

Compared to the new Hammerspoon version above, this version causes a spike in CPU load every few seconds, because it accidentally wakes up services like ContinuityCaptureAgent.

The version using Hammerspoon is reacting to events from macOS, which makes it more energy efficient and quicker to react.

## Preparations

After researching for quite a while, I found a useful cli tool called [SwitchAudioSource](https://github.com/deweller/switchaudio-osx), that allows to control sound devices on macOS.

You can install it using [Homebrew](https://brew.sh/):

Bash

```
brew install switchaudio-osx
```

## The fix script

The following script runs a constant check loop and queries the current audio devices every 2 seconds. If the AirPods are connected and configured as audio input, it changes the input to the microphone and plays a sound as signal.

The sound is quite useful to me, as I wait for it after putting my AirPods on as indicator that everything is configured and I can join meetings safely.

[autoswitch-microphone/autoswitch-microphone.sh](/code/autoswitch-microphone/autoswitch-microphone.sh)


```
#!/bin/bash

set -eo pipefail

#
# Based on:
#   https://apple.stackexchange.com/questions/429674/how-can-i-make-my-mac-automatically-switch-to-a-new-speaker-when-it-is-connected
#   https://github.com/deweller/switchaudio-osx
#

AIRPODS="AirPods von Mitch"
MICROPHONE="USB Condenser Microphone"

PATH="/opt/homebrew/bin/:/usr/local/bin/:$PATH"

echo "Starting main loop at $(date)"

while true; do
    CURRENT_INPUT=$(SwitchAudioSource -c -t input)
    CURRENT_OUTPUT=$(SwitchAudioSource -c -t output)

    if [ "$CURRENT_OUTPUT" = "$AIRPODS" ]; then
        if [ "$CURRENT_INPUT" != "$MICROPHONE" ] && [ "$(SwitchAudioSource -a | grep -c "$MICROPHONE")" -gt 0 ]; then
            date
            echo "Input:  $CURRENT_INPUT"
            echo "Output: $CURRENT_OUTPUT"
            echo "Switching to your microphone..."
            SwitchAudioSource -t input -s "$MICROPHONE"
            sleep 1

            # Wait a moment, or it's chopped off
            afplay /System/Library/Sounds/Funk.aiff
        fi
    fi

    sleep 2
done
```

If you want to use this script, don't forget to update the marked lines with the names of your devices. If you're unsure about the names, run the following command to see all connected devices:

Bash

```
SwitchAudioSource -a
```

## Starting at boot

Running this by hand every boot is annoying, so let's integrate it into launchd, the macOS service manager.

You must adapt the marked paths in the file to your system, as launchd unfortunately doesn't support environment variables (like `$HOME`) for these settings.

`StandardErrorPath` and `StandardOutPath` are quite useful for debugging, but can be removed later if everything is working properly.

[autoswitch-microphone/autoswitch-microphone.job.plist](/code/autoswitch-microphone/autoswitch-microphone.job.plist)


```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
    <dict>
        <key>KeepAlive</key>
        <dict>
            <key>Crashed</key>
            <false />
            <key>SuccessfulExit</key>
            <true />
        </dict>
        <key>RunAtLoad</key>
        <true />
        <key>Label</key>
        <string>autoswitch-microphone.job</string>
        <key>Program</key>
        <string>/Users/mitch/dotfiles/autoswitch-microphone.sh</string>
        <key>StandardErrorPath</key>
        <string>/Users/mitch/autoswitch-microphone.log</string>
        <key>StandardOutPath</key>
        <string>/Users/mitch/autoswitch-microphone.log</string>
    </dict>
</plist>
```

Put the `.plist` file into `$HOME/Library/LaunchAgents/` and execute the following command:

Bash

```
launchctl load -w ~/Library/LaunchAgents/autoswitch-microphone.job.plist
```

Now connect your AirPods and wait for the signal. If it doesn't play within 3 seconds, check the output of the logfiles.

## Stopping the service

To stop the service again, just unload the LaunchAgent:

Bash

```
launchctl unload -w ~/Library/LaunchAgents/autoswitch-microphone.job.plist
```

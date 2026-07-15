<!-- 来源信息区：本区不是原文正文。 -->

- 来源机构或作者：Hacker News 讨论；发帖人 mrtksn
- 原始网址：https://news.ycombinator.com/item?id=41695756
- 发布或更新日期：September 30, 2024
- 获取日期：2026-07-16
- 原文语言：English
- 清洗说明：网页导航、广告、脚本、重复页眉页脚和其他页面界面噪音已清除；正文内容保留。
- 图片或附件：本页没有需要单独归档的二进制图片或附件。

---

# Show HN: A macOS app to prevent sound quality degradation on AirPods

[Show HN: A macOS app to prevent sound quality degradation on AirPods](https://apps.apple.com/us/app/crystalclear-sound/id6695723746?mt=12)

### Comment 1

This sounds like a great idea.

It's not a company unto itself -- you can't do subscription, do $3.99. There has to be some sheen of continued value generation on the producer side beyond maintenance and bug fixes to justify a subscription. Here, you're going for an impulse buy.

I *highly* recommend cutting down the word count for the description.

You want it to be a 10 second no-brainer, open link, read description, realize its well-founded and my $4000 MacBook Pro has a fundamental problem with my $200 headphones that I can solve immediately for ~nothing.

FWIW you lost my attention around here, though there is excess fluff throughout: "Since recently Shazam is built in into macOS and you can access it from the menubar to find songs, even with your AirPods on. It's fantastic, you should use it all the time."

In general, gotta be ruthless and cut everything out that isn't necessary. I don't care A) when Shazam was introduced B) I can use it even with Airpods on C) what you think of it D) what you think of how often I should use it. All you need is "You can hear the bug: with your AirPods on, play a YouTube video, then click Shazam in the macOS menu bar, then stop Shazam and unpause the YouTube video. How does it sound?"

You're not cutting it out because *I don't care*, you're cutting it out because you have about 10 seconds of attention if you're lucky, and if it runs out, you're done.

Note: I struggle with this 100% of the time :) key to understanding it more was realizing "I don't care" wasn't voiced in an aggressive way, like it would be in conversation. It meant "this was a sentence where I lost attention", and is a license to believe your message is 100% clear, in fact > 100 + x% clear and all you have to do is cut x% and you're optimal. Good position to be in.

### Comment 2

This is really a Bluetooth issue. The same happens with any headphones that have a mic on any OS.

When Bluetooth mode is switched from Headphones to Headset (with mic), only much lower quality audio codes are used.

Does anyone know if Bluetooth 6 adds support for higher quality codes for Headset?

It's a big issue, in my opinion.

### Comment 3

It was a Bluetooth issue years ago. Now it's only an Apple issue where it can't use a more decent codec. On Linux you can choose the mSBC codec and get decent two-way quality on a modern headset.

### Comment 4

>Bluetooth issue

Its a *licensing* issue. The borderlands between the headset and headphone profiles are rife with licensing land-mines - developers have flipped the table and rage-quit the issue, and this technical debt has been shipped.

(Disclaimer: I make headset/headphone firmware for a major competitor and deal with this issue every single week...)

### Comment 5

I just encountered the term "The Ultimate Sadness" reading [https://www.computerenhance.com/p/the-case-of-the-missing-in...](https://www.computerenhance.com/p/the-case-of-the-missing-increment) immediately before this post and I feel like you've found an even worse sadness to deal with on a regular basis.

My sympathies, and I appreciate your willingness to wade through neck deep licensing excrement to produce something that still works.

### Comment 6

This honestly sounds like a problem I would *expect* to be solved by white-labelled AliExpress junk products, whose manufacturers can just ignore the licensing issues entirely, because they’re able to hide their IP violations behind reselling through endless shell companies.

But I guess it isn’t solved by that. *Why* isn’t it?

### Comment 7

You can't hide from the fact that you have to get your chips from somewhere, and those chips have to run some software, and if you are going to just copy others' software, you inherit their technical debt too - unless you invest in fixing their bugs - and what white-label AliExpress junk product provider *has the time for that*?

### Comment 8

Regardless of codecs, don't all Bluetooth headsets switch to mono I/O when the microphone connects? I find that to be a much bigger quality hit than the encoding.

### Comment 9

Not on Windows to my knowledge.

Using the same headset on both Windows and Linux leads to a very different experience. Windows works fine. Linux has the issue macOS has mentioned here.

### Comment 10

> It was a Bluetooth issue years ago

It still is, mSBC is really not that good, plus all things considered reasons go beyond just the codec, see my nearby comment: <https://news.ycombinator.com/item?id=41705258>

Switching to "2x half-duplex" *on both ends* is really the best thing. I hate it that you can't separately select audio input and output in iOS.

### Comment 11

The macOS utility Audio MIDI Setup allows you to pick separate devices for this and it also lets you separate the device for system sounds from the device for other sounds.

### Comment 12

mSBC is still crappy quality compared to what I get on my smartphone. But still Linux allows me to easily use AAC or APTX codec and a separate mic if I want.

I don't understand why all desktop OS can't have something better while when I pair my Bose headset on my smartphone it seems to be using a better quality codec profile.

### Comment 13

mSBC has garbage audio quality.

### Comment 14

idk man airpods do switch to an AAC variant called AAC-ELD for bidirectional audio but thats still compressed to hell. better than SBC but not as good as unidirectional AAC.

I had high hopes for BLE Audio but that seems to be stalled

### Comment 15

No, I've had this happen multiple times using various bluetooth headphones with my Google Pixel 8. So it's definitely happening on Android as well.

### Comment 16

It happens on Windows too. In fact it's probably worst there, because the Windows Bluetooth stack is so awful.

### Comment 17

> Now it's only an Apple issue where it can't use a more decent codec.

Isn't this a Mac-specific issue? I have some recollection in my head that Mac OS uses a terrible codec for bidirectional bluetooth audio, but iOS uses a good one.

### Comment 18

It’s sometimes still an issue on windows but besides advertising the headset audio device most good headsets will create one or more additional audio devices that support high quality input and output.

### Comment 19

Yet another Apple gotcha. I stoped paying the Apple tax long ago. The “ it just works” mantra is long gone

### Comment 20

Bluetooth 5.2 was supposed to fix this issue. Indeed, my S22 phone with Jabra Elite 8s sounds great in calls.

MacBooks newer than 2023 SHOULD have better call quality. They have Bluetooth 5.3¹. Can anybody confirm this? I have been meaning to try pairing my earbuds with a floor model at a store and testing audio quality but's only to satisfy a curiosity for me.

---

1. <https://support.apple.com/en-us/111838>

### Comment 21

I've always thought that my 3.5mm corded earbuds, with a mic pill that hangs near my throat, have great mic quality and even better ambient rejection compared to the distant mic buried in the speaker grille of my laptop. Importantly, it's not incredibly disruptive to type notes or use the laptop while in the meeting.

Is this specifically a Bluetooth headphone thing, or an "any headphones with a mic on any OS" thing?

### Comment 22

MacOS excels at noise cancellation. Typing on my Windows PC sounds like an earthquake, but you could actually hammer nails during a video call on a Mac and it wouldn't be picked up (it also blocks your voice from coming through, but that’s temporary)

### Comment 23

Why is Bluetooth so bad? This, plus the literal *second* of latency to my car's speakers.

All these problems are solved by headphones with proprietary wireless dongles and they work great, so why can't Bluetooth incorporate those improvements so we can get them on other devices than desktop PCs?

### Comment 24

Also, wireless subwoofers (that come on many consumer TV speaker systems these days) don't have this latency problem either. You just plug them in and they sync to the system and work transparently. They *can't* have any noticeable latency, or else the bass would be out-of-sync with either the rest of the audio, or if they slowed down the audio to account for latency, then all the sound would be out-of-sync with the video you're probably watching with it.

### Comment 25

There are more ways than using bluetooth to transfer digital audio wireless. Probably they are using a custom protocol.

### Comment 26

Yes, that's what I mean: they're basically doing the same thing as Bluetooth, but their proprietary implementation isn't saddled with the huge latency problems that Bluetooth has. So Bluetooth seems to be a poorly designed protocol.

### Comment 27

Those generally uses a custom 2.4GHz RF protocol, like gaming headsets and mice with dongles.

### Comment 28

The bass can be sent with a lower bitrate since the output signal is low frequency anyways.

### Comment 29

> Why is Bluetooth so bad?

From what I read online, Bluetooth standart is bloated with outdated profiles and not free for manufacturers to implement. Because of that, manufacturers strap own proprietary extensions on it that only their devices support (e.g. AirPods audio qulity with mic is only good on Apple devices)[1].

Others mention that bluetooth was initially designed for less capble devices, thus suffering from low bitrate and signal strength.

Adjacent discussion here: <https://news.ycombinator.com/item?id=40180133>

[1]: [https://medium.marco.zone/apple-implemented-the-biggest-impr...](https://medium.marco.zone/apple-implemented-the-biggest-improvement-to-bluetooth-audio-since-2009-2079abc607af)

### Comment 30

Given how much Apple and other manufacturers depend on Bluetooth for their wireless earphones I wonder why no alternative to Bluetooth ever seems to show up.

### Comment 31

I think because all the hard work put into open-source bt ecosystem (bluez, pulse, pipewire) makes it "good enough" for average users.

### Comment 32

One would think that if some company could credibly exorcise the demons of crappy Bluetooth connectivity, that would be a huge selling point though. I don’t think anyone hasn’t experienced the finnickiness of Bluetooth.

### Comment 33

We currently have Bluetooth headphones in the market that are not even using the current spec/API properly. For some of them, the hardware is perfectly fine, if they did use the API correctly, the experience could be almost as good as AirPods are on OSX.

### Comment 34

The irony is that even among the same brand they differ vastly:

*Beyerdynamic MMX 200* does it wrong: pair up to, uh, I don't know (undocumented!), n>2 devices (I have 4), connects to the last one on power up, but if you want to switch devices, you have to disconnect on the device it has just connected and hope it doesn't connect to yet another you have paired and happens to be in range but is not the one you want to pair with, or you have to disconnect from there too. Confused yet? Yup, it's that bad.

Worse, upon that second disconnect the headset itself initiates a reconnect by going through the MRU list again, so if you disconnect from the second (incorrect) one it might try the first (incorrect) one again since it's now the next in the MRU list, so you actually have to DISABLE BLUETOOTH on each device except the one you want to connect to.

Too bad if one of these devices is in the next room, even more annoying if it's your iPad borrowed by your SO who is now annoyed at losing sound from their movie.

At that point, it's easier to forget the headset in the device you have in hand and re-pair, which is absolutely ridiculous.

*Beyerdynamic Free BYRD* does it correctly: pair up to 5 devices, connects to the last one on power up, any device in the pair history can force-connect to the headset, yanking out the virtual cord from the undesired device. No interaction required on any other device.

Even better, when pulled out of the charging case they actually wait a bit (a few seconds? or detecting when they're put in ear?) so you can actually invoke some quick setting pane and connect without the connection ever going to an unsuspected device.

Dishonourable mention for *Bose QC-35 II*, who operates like the MMX 200, only it has two BT radios as an attempt to work around that it's doing it wrong. So, it connects to the last *two* devices. Unfortunately if I'm walking around the house listening to music and the second-to-last device goes out of range the headset goes "<device name> disconnected" then a few moments later "<device name> connected", which is horrible when <device name> is made out of a serial number (work laptop) and it goes on to spell it out "C. O. M. P. H. 4. 7. X. 3. 9. 9. 7. P. K. Q. L. disconnected".

The only way to prevent that is to go through the Bose app and remove devices from the history, essentially pairing it with one-device-at-a-time only. Oh, it's also great for jump scares when your SO is aping the iPad again and it turns out the headset is connected to it. All of which could be avoided if it behaved like the Free BYRD.

### Comment 35

Sounds more like a shitty-software issue. The Shazam function should turn the Bluetooth mics off after the song is identified. Why does it just leave them on?

Isn't that obvious, or is there some aspect to this I'm not aware of (I care about sound quality, so I don't use AirPods)?

### Comment 36

It's not just Shazam but any app that uses the mic over Bluetooth. Like if you wanted to have background music playing during a Zoom call, or wanted to wear Bluetooth headphones while gaming and voice chat kicks in when you group up, etc.

It's a very annoying problem because the Airpods actually sound fantastic, but as soon as the mic kicks in, it sounds like crap. Same thing happens with my Sony XM3s or any other Bluetooth headset. The protocol drops to a shitty bitrate to support full duplex.

### Comment 37

what you are describing is a universal Bluetooth issue. Windows suffers the same; some Android devices support proprietary codecs to slightly improve the situation but it's still sad we are still here.

### Comment 38

Understandable, but in that case what's the value of the utility posted here?

### Comment 39

It just automates the manual workaround: It tells your system to use another mic, not the bluetooth one, so that the bluetooth headphones go back to listen-only mode and doesn't have to operate in its inferior full-duplex mode. So you'd use the headphones only for hearing, and your computer's internal mic (or another external mic, like a webcam's or a standalone USB one) does the recording input.

I do that for all my calls and games already, but I just have to manually set it in the OS (and sometimes on a per-app basis). It only takes a second and usually remembers.

If the app were a one-time purchase I'd probably buy it just to avoid the hassle, but definitely not paying a subscription for something that's so easy to do on my own. As a compromise, I'd also be OK with a OS-version tied upgrade pricing, like you pay $x for the macOS 15 version, but when the next breaking OS update comes that requires an update, you can pay $y after the upgrade discount to get the newest version that works with the new OS.

### Comment 40

Thanks for the info. And I fully agree about the pricing; that's just dumb.

### Comment 41

The default behaviour is designed intentionally to 'degrade to the least-costly codec license' .. since the codecs available to the end user are one of the only ways that different headset/headphone manufacturers can differentiate, doing whats necessary to degrade to the least common denominator allows developers to route around the issues imposed on them by management: namely, don't promote the features of other headset manufacturers, needlessly.

### Comment 42

> This is really a Bluetooth issue.

Yes and no. Part of it is also how the OS is used.

Sure if you want to use the mic on your headset you are forced to use a lower quality codec, but on my Fedora I select which profile I want to use on my bluetooth headset[1]. If I set it to AAC or APTX it will not activate the microphone.

And I can easily select which device is the primary device for inputs, outputs or individual apps.

[1] Typically using pulseaudio volume control which is compatible with pipewire (or rather the opposite).

### Comment 43

It's not just codecs that are different between HFP and A2DP (although that is a big part of the issue). HFP uses an older way (SCO) of transferring the audio which gives much less bandwidth.

What we need is a new profile that uses A2DP in once direction and in the other for the microphone. I suspect the reason it has never happened is that there's a good chance of causing issues with existing devices that do at least work with HFP.

### Comment 44

Samsung phones paired with Samsung earbuds also, on paper, support high-quality audio for calls.

### Comment 45

- Menu bar only app, no option to disable and make dock icon app only
- Subscription only app, forced to buy the subscription instead of offering no-credit card trial

I really do want to support devs and I appreciate another tool that someone created to solve a known issue so real kudos for that.. I just don't like the common bandwagon trends this one is jumping on.

### Comment 46

"you want to hear from your AirPods but be heard from your internal microphone"

I wish all people would know this, I have CTO coaching sessions and when people attend with AirPods microphones, 60minutes is such a drain because of the bad mic quality of AirPods - and people seem not to realize this.

### Comment 47

Are you the one doing the coaching? Wouldn't this be part of coaching them?

### Comment 48

Yes. It is a minor part of coaching, like sending out good microphones, headphones and cameras if needed to all devs to minimize zoom fatigue.

(I once nearly was fired as CTO when I bought QC headphones for everyone in an open-plan office because of the money, which compared to our other IT expenses in my budget was a blip)

### Comment 49

Usually, if I feel this, it means I have to get my AirPods cleaned (do it at the store, it's worth it). I have, subjectively, always felt that clean AirPods blow the Mac mic out of the water.

### Comment 50

When using two way Bluetooth the bitrate drops sharply. No amount of cleaning can solve this.

### Comment 51

This.

It drains your airpods less too.

### Comment 52

Internal microphone being what? The laptop or the phone? These have absolute shit input when sitting relatively far away on the desk or pocket.

In my own experience, AirPods offer the absolute best microphones for zoom calls, other than professional-level equipment.

### Comment 53

Well "internal microphone" would be any other that's not the one of the Bluetooth headset you're using in the call.

You can use high quality codecs with Bluetooth to listen, but when you use Bluetooth headset as a microphone, it switches to the "headset profile", that has greatly reduced bandwidth and a simpler codec, hence reducing the quality of sound in both directions.

You can very clearly hear the bandwidth difference if you connect to a Zoom call using your Bluetooth headset both for listening and as a microphone, and then switching the microphone to the one in your laptop while someone is talking. I guess that any other software will work, but it's the one I use in the office.

I usually have a high quality microphone on my desk (an AT2020, but you don't need to go that far, I already had it) and use my headset just for listening. But it might not work if you have to talk away from your desk.

I've heard that some people use headsets that aren't bluetooth, like the Jabra or Plantronics that are made for call centers, where you connect the headset base directly to the laptop. They seem to have also an incredible connection range, but they are very pricey so I haven't bought one for testing.

Edit: The "non Bluetooth" headsets I was talking about use the DECT standard. But make sure you get one that has super-wideband support, or you'll have the same mic quality problem. Not the range problem, as it seems like you can even leave your house and keep talking. But they're typically expensive, like USD250-450

### Comment 54

> You can very clearly hear the bandwidth difference if you connect to a Zoom call using your Bluetooth headset both for listening and as a microphone, and then switching the microphone to the one in your laptop while someone is talking. I guess that any other software will work, but it's the one I use in the office.

Maybe this isn’t a problem if you are within the Apple ecosystem, or maybe Apple has solved this problem if you are within their ecosystem (AirPods + Apple laptop)? Or maybe I have terrible hearing. Because no, I can’t hear the difference. It’s actually crisper and clearer with AirPods.

> I usually have a high quality microphone on my desk (an AT2020, but you don't need to go that far, I already had it) and use my headset just for listening. But it might not work if you have to talk away from your desk.

A professional grade external microphone (that is NOT an internal mic) is going to sound better. This has nothing to do with Bluetooth.

### Comment 55

I was talking about my combination of hardware, but I can do that with the integrated microphone in my MacBook and I'll hear the difference too. I can't comment much on Apple Bluetooth devices as Apple hides any codec information: they don't say which codecs and profiles are supported on their devices, and they've removed connection information in their OS, so I have no idea. But from what I've seen online, it's been problematic even for AirPods + Macbook users [0]

I haven't tested with any AirPods, and I don't know if they do non-standard things, but I've tested with a multitude of Bluetooth headsets and adapters, of different brands and supported codecs and all do the same thing.

This is because different codecs are only supported in the A2DP profile that's unidirectional. Once you use the microphone it needs to switch to the headset profile (HSP)or the hands-free profile (HFP).

HSP is very low quality in both directions, using a very low bitrate PCM encoding. Regular HFP is a bit better, also low bitrate PCM, 8khz sampling rate, but no good. HFP from version 1.6 supports a mono channel SBC encoded but in a 16khz sampling rate. Better but not great at all.

There's also a pair of codecs (FastStream, AptX LL) that support a duplex channel to send microphone audio back in good quality, but device support is not great.

And theoretically Bluetooth 5.2 with LE Audio supports Isochronous Channels, but I have no idea what hardware supports that.

So: Bluetooth audio is a mess. You need to mix and match a combination of standards and codec support in your computer hardware, your computer OS, your phone hardware, your phone OS, your headphones... quite a party.

```
  ---

  0: https://old.reddit.com/r/airpods/comments/k3kosn/m1_mac_owners_is_airpod_mic_quality_improved_on/
```

### Comment 56

> I've heard that some people use headsets that aren't bluetooth, like the Jabra or Plantronics that are made for call centers, where you connect the headset base directly to the laptop. They seem to have also an incredible connection range, but they are very pricey so I haven't bought one for testing.

Just get a cheap gaming headset.

Pretty much all wireless gaming headsets also have perfectly fine quality for two-way communication, and you can get completely reasonable ones for ~$50-$100.

Remember, the primary use case for these is to mix gameplay, music, and voice calls while also keeping the latency very low. Bluetooth would never fly in that world, and it's bizarre that it's tolerated elsewhere.

### Comment 57

All wireless gaming headsets that I've seen are Bluetooth.

What I've seen from some of them (or even some headsets that aren't "gaming") is "Gaming Mode", that usually means that they either use a low latency codec like aptX Low Latency, or reduce the buffers in the connection or something like that. That's also useful to reduce latency when watching videos or TV.

But once you switch to headset mode, you're back to the low quality mode every Bluetooth headset uses.

Meanwhile, as I cannot justify (to myself) the $350 expense, I'm using a $65 1More Sonoflow headset that works great for me and also have aptX codecs.

### Comment 58

> All wireless gaming headsets that I've seen are Bluetooth.

Which have you been looking at? Typically it's just labeled as 2.4GHz in the spec sheet (yes, it's a bit silly since Bluetooth operates in the same band.. oh well).

I just went through my local IT store's cheapest wireless gaming headsets[0] (ignoring colour variations), and I saw:

- HyperX Cloud Mini Wireless[1], Bluetooth, 549kr (~$55)

- Deltaco Gaming Headset Wireless RGB[2], custom wireless, 699kr (~$70)

- Logitech G435[3], Logitech Lightspeed (also *optional* Bluetooth), 799kr (~$80)

- HyperX Cloud Stinger Core Wireless[4], custom wireless, 899kr (~$90)

- ASUS TUF H1 Wireless[5], custom wireless, 979kr (~$100)

That's less than half of them with Bluetooth support at all, and only one that requires it.

[0]: [https://www.inet.se/kategori/901/gamingheadset?sortColumn=pr...](https://www.inet.se/kategori/901/gamingheadset?sortColumn=price&sortDirection=asc&filter=%7B%22propertyFilters%22%3A%7B%22bool%22%3A%7B%22175%22%3Atrue%7D%7D%7D)

[1]: [https://www.inet.se/produkt/6611818/hyperx-cloud-mini-wirele...](https://www.inet.se/produkt/6611818/hyperx-cloud-mini-wireless-svart)

[2]: [https://www.inet.se/produkt/6306122/deltaco-gaming-headset-w...](https://www.inet.se/produkt/6306122/deltaco-gaming-headset-wireless-rgb)

[3]: [https://www.inet.se/produkt/6601744/logitech-g435-svart#spec...](https://www.inet.se/produkt/6601744/logitech-g435-svart#specifikationer)

[4]: [https://www.inet.se/produkt/6608769/hyperx-cloud-stinger-cor...](https://www.inet.se/produkt/6608769/hyperx-cloud-stinger-core-wireless-7-1)

[5]: <https://www.inet.se/produkt/6302556/asus-tuf-h1-wireless>

### Comment 59

Oh, I thought the Lightspeed protocol was only for keyboard and mice, as that is/was what they first claimed on their site somewhere. I guess that I always skip those headphones due to the design.

The problem I see here (and in other propietary protocols) is it's very difficult to know what's the quality of the audio stream. Can't find any information about the codecs, sampling rate, bitrate... and the microphone reviews that I've found for that kind of headsets sound very bad.

With the prices on good quality wireless headsets I sometimes feel like I'm going to end up buying a broadcast quality headset with a long cable and forget about it :D

### Comment 60

"sitting relatively far away on the desk or pocket."

So it seems to be primarily about your convenience vs. the other persons fatigue.

We need an Usenet Etiquette for Zoom calls.

Just google for "airpods terrible microphone"

MacBooks and iPhones have much better microphones than AirPods.

### Comment 61

Or a decent quality but entry-level USB mic, which is certainly not considered "professional-level" by any standard.

### Comment 62

I was implicitly comparing within the same form factor...

### Comment 63

Couldn't I just make an aggregate audio device which uses the mic on my MacBook Pro, and speakers of the AirPods?

### Comment 64

You don’t even need it to be as complex as that, I just have an aggregate device which only has the MacBook microphone input enabled and no outputs, then you set this as your \_input\_ device in Sound preferences, but leave the output device as is.

It’s easy to create the aggregate input device, go to the Audio MIDI Setup app, in the audio window click the plus in the bottom right and choose “new aggregate device”, then tick MacBook Microphone on the right. Then to System Preferences > Sound > Input and assign this new “virtual” device as your input device. (You can rename it if you want)

Now your Mac will automatically switch audio output source as usual, but the input remains locked to the microphone so you don’t get this annoying problem.

### Comment 65

I was excited to try this, since I'm a bit tired of selecting the input manually multiple times per day. Unfortunately, connecting AirPods automatically switches the input to them, regardless of the previously selected input device, whether it's an aggregate device or not.

### Comment 66

Hm let me double check on this tomorrow! It works with my Sony headphones (which also cause MacOS to go into bad audio mode when you eg launch Shazam) but not sure I have tried the same with AirPods. Unless I did something else to lock it to that device and I’ve forgotten… anyway I’ll check on my work machine tomorrow

### Comment 67

It works with your Sony headphones, cause MacOS only forces the headphone mic for apple headphones. Sucks, but is the annoying truth.

### Comment 68

What exactly is the logic osx is using here that causes non-aggregate input to always be switched when plugging in external source, but aggregate sources remain sticky?

### Comment 69

Option + Sound menubar icon = choose individual input output devices. Solution I use for the occasion the OP's app was built for.

### Comment 70

That's exactly what I do - An aggregate device (called 'Forced Onboard Mic') with only 'MacBook Pro Microphone' selected.

This is configured from 'Audio MIDI Setup.app'

Apps configured to use that as their input device then don't reconfigure themselves whenever a Bluetooth input device shows up.

I dont add output devices as I'm happy for that to flip between speakers/headphones - whatever is available.

### Comment 71

If you option click on the speaker icon in the menu bar, you can select which input to use. Takes a second and works instead of needing an aggregate device set up.

### Comment 72

That’s a good idea, I will consider it. Should check it how it works with AirPlay and continuity though. AirPods are not simple Bluetooth devices, strange things happen when connecting/disconnecting.

### Comment 73

That's a clever idea. I'm not in a position to try it right now, but would love to know if this works. I always use my AirPods + an external mic.

Also I haven't upgraded macOS to >= 13 yet on my personal laptop, so I can't use any of these apps.

### Comment 74

Subscription discussions aside, if you're looking for more feature requests, one thing I'd love is the ability to completely disable audio input devices on OSX. It's something you can't do today. My monitor has an audio in, and shows up as a valid audio input, but there's no mic connected to it. Zoom loves prioritizing it as a device though every time I disconnect my microphone. Likewise other bluetooth headphone audio inputs. Would love the ability to completely remove those as an option in the sound settings.

### Comment 75

A system-wide mute button and a system-wide setting to say "this is the only microphone I want to use and when it's muted I don't want another mic to be used" would be nice. Wired headphones often have a physical mute switch, but zoom will happily switch to another microphone the instant you use the mute switch.

### Comment 76

Pretty sure you can do that natively; [https://support.apple.com/guide/audio-midi-setup/set-up-audi...](https://support.apple.com/guide/audio-midi-setup/set-up-audio-devices-ams59f301fda/mac)

### Comment 77

Negative - you can only remove audio devices with the audio-midi-setup that have either been added from the feature itself, or are using the underlying APIs for audio. None of my 3rd party audio devices (Sony MX-3000, Sony MX-4000, hdmi audio out, thunderbolt doc audio out) leverage those APIs, leading me to suspect this is actually fairly rare.

You can map default audio input/outputs with the tool, but removing the audio output is a different story.

See example: [https://image.non.io/8772f276-c835-479d-8867-2deae630310b.we...](https://image.non.io/8772f276-c835-479d-8867-2deae630310b.webp)

### Comment 78

A good trick to prevent this is to set your microphone to an aggregate device that you create with the Audio Midi Device tool that comes with your mac.

Open that, and create a new aggregate device with just the system microphone. Then set that as the default microphone. And now when applications access the microphone for whatever reason, your bluetooth headphones don't switch profile and keep on using the aggregate microphone device.

It's one of those obscure hacks that should just be default behavior. Why would I want to switch to a low quality audio codec when I have a perfectly good microphone in the laptop? Answer: I don't want to. Never. Loads of people use expensive headsets and they all sound terrible when they take their calls. It's not necessary.

### Comment 79

> *Why would I want to switch to a low quality audio codec when I have a perfectly good microphone in the laptop? Answer: I don't want to. Never.*

Because you're in a noisy or semi-noisy environment.

In that case, even a low-quality codec for a microphone next to your head head will be vastly clearer than high-quality audio from a microphone several feet away from you.

If you're in a quiet room, though, yes the Mac microphone will be better.

### Comment 80

Yep. If you want to avoid paying a monthly fee, I'd highly recommend this approach. I've shown a few of my friends this trick and its worked for years.

### Comment 81

Interesting, thanks for the tip. Does it play nice with AirPods continuity?

### Comment 82

Can you do the same with the iphone?

### Comment 83

No.

### Comment 84

Subscription for an app that has no server component or ongoing costs? This is how you piss off someone to release a free version.

EDIT: seems someone already did long ago: <https://github.com/milgra/airpodssoundqualityfixer>

### Comment 85

I wouldn’t be surprise if OP ripped off the code from here, changed some of the assets, and republished under App Store to get subscription $

### Comment 86

it's funny how lonux just show you the codec in a drop-down next to the volume control. kde users living in the future as always.

### Comment 87

Switching to headset mode has always worked for me, but switching back to headphones mode often ends up as a no-op. The button is there, but it sometimes just doesn't work. Perhaps that's why other operating systems lack this feature, they know their underlying stack and the hardware side don't make it as easy as it would otherwise seem.

### Comment 88

Linux fanboys can't wait to talk about the one use case it's better than MacOS for

### Comment 89

I've had to use the Mx-pro MacBooks at work for the last few years, and I'm curious what features you actually prefer on MacOS?

I've had no end of unstable wireless stacks, ungrounded computers causing a physical buzzing as you touch the case, the GPU crashing when viewing Google Sheets, LCD panels failing from the arduous task of letting the laptop sit on the desk for a weekend, automatic updates wiping manual setting changes, switching to any available WiFi network if the one I want has a blip in service and never switching back, needing to reboot into recovery mode for something as simple as enabling dtrace, ....

They just feel shoddy, and combined with a non-discoverable UI and default behaviors I don't like, about the only thing I've really cared for is the battery life. Even if they were free I don't know that I'd use one at home instead of some flavor of Linux.

### Comment 90

> Most of the time, you have much higher quality microphones built in, so in most use cases, you want to hear from your AirPods but be heard from your internal microphone

Is that true, have I been doing my google meets wrong this whole time?
So you’re saying if I’m on my Mac and having a google Meet, and I’m using my AirPods, then I should have my mic input as MacBook and not as AirPods?
Do you have any sources or your own empirical evidence that this would provide better sound for the other party?

Even if the microphones are worse on the AirPods (I believe that), I always thought the final voice output would be much better from the AirPods since they are much closer to my mouth and move together with the movements of my head, which I imagined would help with noise reduction / voice isolation.

### Comment 91

Wireless earbuds microphones are famous for poor quality audio, even in the top of the line models. The microphone is indeed closer to your mouth, but the sound in the human speech range is quite directional, and does not travel to your ears as well as it does to a microphone in front of you.

Not to mention the quality of the parts itself is usually much lower than those in the external mics, or the MacBook ones for that matter.

There's a YouTuber called DankPods, reviewing all sorts of headphones lately, along with their mics. Can't recommend any particular video, as the microphone tests are only a tiny fraction of the content, but after watching a few tests this issue become very apparent. Easiest thing to do would be, as other commenter suggested, to test it out for yourself in the voice memo app.

### Comment 92

“Do you have any empirical evidence…”

Ask yourself, “how easy would it be to test this myself?”

Now ask yourself, “how hard would it be for someone else to prove this and give me something that convinces me?”

Even people working in academia don’t say “show me empirical evidence!” This just feels standoffish.

### Comment 93

The Macbook Pro's have good in-built mics, probably the same for higher end windows laptops.

But I imagine the average cheap windows laptop has quite poor quality mics. It would be hard to test though as there are so many models out there.

### Comment 94

Give it a try and see it for yourself. Open the voice memos and record a short message, change the input source and record again. Play the recordings and see which one you like.

To change the input source you can go into System Settings->Sound->Input

Mac microphones are quite good, see if that's the case for you too.

### Comment 95

It depends if you sit for a long meeting or short but important, I’d definitively change the mic to use MacBook it’s not only your quality of mic for them, you’ll hear them much better too.
Now if you want to be walking around while talking then obviously keep the default mic on the AirPods.

### Comment 96

I'm stupefied by this comment thread. I routinely have meetings where my microphone quality (built-in MacBook Pro or iPhone 14 in speaker mode) is absolute shit and the person on the other side tells me to put on my AirPods, at which point my audio becomes crystal clear for them.

### Comment 97

I don't know if it depends on specific models because some people seems to be using Macbook Pros without headset and their voice is crystal clear while other seem to be talking from an old airplane microphone.

Anyway I guess it depends where the macbook is positionned. I am not using a macbook but my laptop is stashed away on a shelf[1] when plugged to my usb-c docking station using external screens so using the embedded mic would be a no starter anyway.

[1] it seems to be cooling and running quieter vertically when its bottom fans aren't obstructed.

### Comment 98

It appears from some google searching that this problem seems to be specific to the AirPod pros. I’ve never used those as I hate the silicone tips.

### Comment 99

I do a lot of zoom meetings with people with lots of different mics including mac ones and various business headsets and laptops and yes, Airpod mics are pretty much the worst of the bunch.

### Comment 100

Congrats on building and launching the app. Building a little tool to solve a problem you have is great.

My only issue is that I'm mostly using the AirPods mic for meetings. I don't want to use my laptop mic because my impression is that it picks up too much background noise. AirPods do too, but I think less so?

### Comment 101

Thanks for the feedback, I guess it depends on which AirPods and which Mac. AirPods Pro 2 are notorious and even my MacBook Air M1 has an order of magnitude better microphone and background noise wasn’t an issue for me. Whatever works best for you!

### Comment 102

The mic quality from my macbook is usually better for me than from headphones, but maybe it depends on the macbook.

### Comment 103

Also on whether you use it in clamshell mode (I believe the microphone openings are under the speaker grills), and on your habits during meetings – I like to walk around while talking.

### Comment 104

~all modern Macs have an electrical disconnect for mics when the lid is closed.

### Comment 105

I'd use it if it was on SetApp, probably not something I'd pay a dedicated subscription for though.

### Comment 106

If people like the app and use it regularly, I will try to get it into SetApp. It's something thats on my mind.

### Comment 107

I appreciate the effort but I’m absolutely not subscribing.

### Comment 108

> *if you use your mic to talk to people or record something, you will have better sound quality too.*

How often do you talk to people or record something *while listening to a streamed song on your buds, ... and which has to be uninterrupted and in high quality*?

### Comment 109

Post-pandemic, you'll find a lot of people using their computers in such a fashion. "hanging out" with people in a voice chat often involves prolonged periods of silence and it's not uncommon for some subset of the voice chat to be doing other things such as listening to music or playing a game.

### Comment 110

Sometimes I'll take my piano or voice lessons remotely, and it's important to have decent audio on both ends. By far the biggest problem is software like Zoom filtering out piano as "non-vocal background noise", but switching to Element fixes that. If I used a Mac though, low-quality bi-directional streaming would hypothetically be a problem.

### Comment 111

You can just alt + click the audio options in the control center to select the input source

### Comment 112

Yeah. Every single time.

### Comment 113

I don't have a mac or airpods so maybe I'm missing some context but paragraphs 2-4 seem to be a digression and actively confused me as to what this does.
I would suggest removing or rewriting them for clarity.

### Comment 114

Apologies for the bad writing, wrote everything at once and posted right away and looking back I see plenty of room for improvement.

The app simply sets the system default sound input/output device in a specific way depending on what’s connected. This fixes the sound quality degradation on Bluetooth headphones with mic. The issue arises when the computer tries to use the Bluetooth mic, in most cases it’s better to use the built it microphone anyway.

### Comment 115

If you're announcing a product on HN, it's worth going back and doing some edits on what you're posting before you click submit. You only get to do this once, and as many have learned, you can't go back and edit. There are a good handful of English and spelling errors which even a quick pass through a spellcheck may have caught :)

### Comment 116

That's true, however I have this observation: When I don't think and edit too much I end up getting much better reaction. Writing in the flow with the emotions somehow is detectable by the reader.

It takes a few seconds to run the text from ChatGPT and make it "perfect" but when you that you also sterilize the text, remove the sharp corners and make it dull.

Of course the basic English grammar errors and the typos could have been fixed!

### Comment 117

I would never use this because it's a subscription, but I do want to commend you for making it. Bluetooth's terrible two-way quality is a pet peeve of mine.

### Comment 118

Do I need this if I already use something like SoundSource[1] to manually set the input source that's not the AirPods microphone?

[1] <https://rogueamoeba.com/soundsource/>

### Comment 119

No, and this just proves to the OP you can charge for an app and not have it be a subscription and it still be a viable business.

### Comment 120

And SoundSource is way cheaper per year on average. Version 5 came 4 years ago as a $40 purchase or a $20 upgrade, so it’s about a half or fourth the annual price. It also has way more features and is far more tested.

If SoundSource is a one-time $40 purchase, I’d be willing to pay not more than, say, $5 one time for just this one of its features.

### Comment 121

I was about to mention. SoundSource is such an amazing app that truly just works. Very reasonable pricing model compared to the greedy subscription model.

### Comment 122

This is an interesting topic for a hearing aid user like me. For FaceTime and other calls on my computer or iPad/iPhone, I always physically switch from my Bluetooth hearing aids to AirPods, since the hearing aid microphone isn't that good for calls (other party has problems hearing what I say). Now, this could be a bandwidth issue. Apple Audio MIDI Setup shows the hearing aid microphone as an 8kHz/16bit mono input device, while the output is 2 channel 32-bit Float 44.1 kHz.

The switching is a bit of a hassle, since I have to remove and turn off my hearing aids (which I would only do in private anyway), before putting in the AirPods. And the reverse, after the call has ended.

Therefore, it would be very convenient if I could just switch to better input microphones, like the MacBook's. I'll give this a try.

If anyone knows if this is also possible on iOS, please leave a comment.

Edit: Thanks to other comments I've learned, that switching to another microphone is built into macOS.

### Comment 123

yes - user-controlled microphone switching is my #1 iOS feature request

i find it very frustrating i can’t use my airpods on calls at all with full fidelity audio using a wired or built-in iPhone microphone, even though lots of the time on long calls i’m pacing around holding my phone anyway

i’m speculating, but iirc apple did put a lot of thought into the design, placement, and noise cancellation for airpods that just might not have been done for your hearing aids. an 8kHz sampling rate can still reproduce frequencies up to 4kHz, which is much higher than you’re probably speaking!

if you’re on a laptop, maybe try recording the audio yourself with both to get a sense of how they might sound and what (macOS) combinations work best

### Comment 124

Great feedback, I should totally incorporate special needs features. Thanks for sharing.

### Comment 125

Can anyone explain why something like this is necessary on a Macbook, but when I use my airpods with my iPhone I seem to get high quality audio and microphone usage at the same time?

### Comment 126

> Can anyone explain why something like this is necessary on a Macbook, but when I use my airpods with my iPhone I seem to get high quality audio and microphone usage at the same time?

Are you sure? How often does your phone have the microphone active while simultaneously continuing to play audio? When the mic is active on a phone it almost always pauses music or video or whatever you're listening to. At that point it can switch modes and then switch back when you're done and go back to music.

On a PC (meaning the overall category of personal computers including Macs, not just a Wintel machine) there isn't that sort of integration. If you start a VoIP call with music going the music just keeps going, so the mode switch is obvious.

### Comment 127

I believe it’s because macOS uses a worse audio codec: <https://gist.github.com/dvf/3771e58085568559c429d05ccc339219>

### Comment 128

I don't think the AirPods support anything better than mSBC for bidirectional audio on iOS either. (AAC and aptX are only unidirectional, and macOS already supports AAC and uses it for the AirPods.)

But maybe iOS just uses the built-in microphone more often to avoid having to switch away from (high quality) unidirectional audio on Bluetooth?

### Comment 129

Considering it is Apple they could also be using a proprietary profile that side-steps this issue, especially since they created their own Bluetooth chip (Apple Hx). But again, I don't know if this is true or not since I don't have an iPhone to test.

### Comment 130

The second-generation Airpods Pro even do feature a custom low-latency audio codec, but it's apparently only used for the Vision Pro (which is a real shame, as it would be extremely useful for latency-critical things like playing rhythm games on iOS and macOS as well).

On the standards side, there's Bluetooth LE audio, which also offers very low latency, but that might actually require hardware changes (I believe there's reliance on some hardware layer changes).

### Comment 131

Not really, the main issue is the Bluetooth profile[1] here. HFP is the profile used for bidirectional (i.e.: when you're using both the headset and microfone) while A2DP is the profile for unidirectional audio (i.e.: when you're only listening). The main issue is that HFP uses a much worse codec than A2DP, that is optimised for voice and not music. Newer versions of HFP supports mSBC that is a simplified version of SBC (the main codec used in A2DP) that is better but still significantly worse than SBC (and SBC is not considered a good codec anyway).

However I can't really answer OP question. I am not sure how iPhone get a better sound quality if what OP is saying is true (I don't have an iPhone). What I know is that in Linux you can activate mSBC and this improves the quality a lot when using HFP profile, but it is still significantly worse than anything A2DP has to offer. I also think Android uses mSBC if available, but I am not completely sure.

[1]: <https://en.wikipedia.org/wiki/List_of_Bluetooth_profiles>

### Comment 132

I believe this is the correct answer.

### Comment 133

I can confirm it is, and all things considered reasons go slightly beyond just the codec, see my nearby comment: <https://news.ycombinator.com/item?id=41705258>

### Comment 134

I learned something today! Didn't realize that the microphone could throw off audio quality indirectly. Sidenote: this might do well on SetApp.

### Comment 135

There are two bluetooth profiles in use here: "A2DP" (Advanced Audio Distribution Profile) and "HFP" (Hands Free Profile).

A2DP is how you send high quality audio over standard Bluetooth. The basic codec is OK, and you can negotiate much better ones. It's only one direction though, no microphone

HFP is the classic profile that's been around since the dawn of Bluetooth that allows you to make calls. You get microphone in one direction and (mono) speaker in the other, but it works in a fundamentally different way to A2DP and so the bandwidth and codec selection are much more limited.

Bluetooth devices can only do one of these at a time, so if you're just playing audio you get A2DP. But if there's a need for the microphone it has to switch to the other profile, and you get the low quality audio. At least these days software (usually) does do this switch seamlessly, it used to be worse...

### Comment 136

This is more or less only (sadly) a problem with apple headphones.

You can switch the current microphone on Mac by ALT-Clicking the audio menubar icon. Normally MacOS will remember and follow your decision, except when you have apple headphones. For some stupid reason MacOS forces the headphone microphone on those.

### Comment 137

Not true. I have a HyperX moc and it’s always the default, no matter what app I use. I have several Apple headphones, works that way with all of them. macOS 14.7 now, it’s always been this way.

### Comment 138

Never had a problem using my Sennheiser PCX 550 (Bluetooth) with a Rode Video Mic Go II (USB). But when connecting my AirPods MacOS would switch the mic to them.

### Comment 139

I mostly use Zoom for work calls, you can select microphones and speakers individually. I found that if you select your Airpods as your speakers and your laptop as your microphone, the sound quality on the Airpods suddenly get way better.

### Comment 140

Yes, because when you switch on the mic on most Bluetooth headphones, it will switch to the headset profile and use the SBC codec in place of AAC. Also see here for a longer description:

[https://www.recadio.com/blog/why-is-bluetooth-sound-quality-...](https://www.recadio.com/blog/why-is-bluetooth-sound-quality-bad-on-my-mac)

Apparently newer generations of AirPods use the AAC-ELD codec which should improve this on Apple devices.

You should be able to see in Console.app what codec gets used.

### Comment 141

I just learned about hammerspoon because of this, automate macos with lua, nice: <https://github.com/Hammerspoon/hammerspoon>

### Comment 142

I bought it and doesn't do what it says it does in my case.

When i connect airpods, it selects airpod's microphone every single time.
in preferences I can't add a new mode.

### Comment 143

Other than using Shazam, when is this an issue for people? On Zoom or Facetime, the audio connection is almost certainly using an HFP/SCO connection, which is going to downgrade to an 8K or 16KHz sample rate regardless of where the mic is coming from.

I don't use Shazam, but it doesn't actually make sense to me that you would even use Shazam while listening to audio in your Airpods. I thought that was for music you heard from something other than your own device. You are listening to music in your Airpods and trying to identify a song from another source at the same time?

This just isn't making sense to me.

### Comment 144

AirPods Pro 2 mic is so, so bad. Went back to EarPods ($22 CAD on sale) -- the mic is practically studio quality now.

### Comment 145

I love my EarPods except for the sticky finish on the cable - they snag and drag on everything. I’d desolder and sleeve with paracord if it weren’t so time consuming.

### Comment 146

Is it the Mic or the fact that it switches to a lower-quality codec when the mic is also used. EarPods are wired, so don't have the same issue.

### Comment 147

I had no clue the drop on quality was due to bandwidth. I don’t have AirPods but it’s something interesting to look into

### Comment 148

I'm honestly asking this with minimal snark, but...

Does macOS not have a setting where the default audio out and in device can be selected and configured independently of the actual physical device connected? On Windows and LinuxMint it's a change in the settings app, and it persists between Bluetooth device reconnects. Windows abstracts the audio in and out away from the actual device, and they show up as two separate devices on my machine. When I re-pair my headphones I need to change the setting again, but that rarely happens.

This has been a non-issue for me for years. I have one bluetooth headset that does not play nice with MS Teams (Shox OpenRun), but I don't use it for calls any more.

### Comment 149

It has, It's just that you have to do it every time.

### Comment 150

This has been one of my fixations. That it‘s still an issue 20 years after Bluetooth audio has become a thing and 10 since telephony has become good quality is crazy to me.

It has been a few years since LE Audio has standardized and a lot of digging has led me to the conclusion that it should support decent audio with multiple channels (as it‘s not artificially limited like the Hands Free Profile). I‘d have expected Apple to jump on this to finally solve this stupid issue once and for all, but … nope.

I just want to listen to music while on a phone call. It’s not that crazy.

### Comment 151

Yes, LE Audio is supposed to improve the situation in multiple ways (e.g.: lower latency, lower battery usage, multiple channels, etc) but sadly there is still no headset that supports LE Audio without hacks (e.g.: my wf-1000xm5 supports it but you need to flip a flag inside the app and it only works in specific devices and it also disables lots of features).

### Comment 152

Crazy, eh? I‘d make good quality phone calls a selling point. After some conversations about this I’d wager that a non-trivial number of people at least knows this problem.

### Comment 153

OT but another reason why I got wired headphones for my desktop :)

### Comment 154

Personally I’m just tired of the many exceptions and areas of shitty UX in the Apple ecosystem. macOS itself has taken a real shitter in the past 5 yrs. Every new major upgrade manages to break my workflow. Which is why I have switched to waiting for 3-4 months before upgrading.

### Comment 155

Nice job. Price seems fair to me. You’ve found a problem and fixed it. This crowd always bemoans paid (and closed source) things so I’ve come to largely tune that out because it’s just a given.

### Comment 156

This seems like a $5/year app—not a $20/year one. Or, make it a one-time $10 charge; if future MacOS versions require significant work to keep it up to date, charge an upgrade fee.

### Comment 157

This seems like a $5 app full stop, not per-year. There's ~zero ongoing costs involved, and bugfixes that justify renewed purchases would be keeping up with any OS breakages which realistically should be exceptionally rare, but definitely aren't yearly regardless.

### Comment 158

Annual macOS releases regularly make changes to the bluetooth stack and the sound stack.

Additionally, there are always new Mac products as well as new AirPods products being released, and getting them working on new hardware has costs (including but not limited to acquiring that hardware).

I find it extremely frustrating when apps stop getting updated and become abandonware because they relied on new customers to pay recurring bills (rent, groceries...) instead of relying on recurring payments from existing payments who derive value from their product.

Everyone wants the price to be lower, which is fine, but saying that you don't want to pay on an ongoing basis but still want to receive ongoing updates is not fair.

### Comment 159

Thanks a lot for the kind words. I totally expected the backlash, let's see if I can get some customers and I can make them stay.

### Comment 160

A paid subscription... really?

### Comment 161

I have initially thought this piece of software is going to fix my AirPods Pro noise issue :)

### Comment 162

> I decided to go with a very cheap subscription model because I suspect further development might be needed as bugs emerge or API behavior changes

Right, makes me wonder how did companies even exist before the subscription model.

> I don't know what would the right price be for supporting an app for years to come and still have people willing to pay for it

Not to sound too negative, but your app might not even exist a year from today. It's a single utility app, let people buy it if they want to fix a bug with Bluetooth+AirPods, not to subscribe to a bug fix.

### Comment 163

>Right, makes me wonder how did companies even exist before the subscription model.

They abandoned their products once the growth stopped and/or switch to subscription and gave their one time purchase makers a year of subscription to make it up.

One time payment for lifetime support doesn't make sense whatsoever. If it is a large company they have to employ people for a product that doesn't bring in money and for indies it means that they need to switch context from their current project, study their code and try to remember what they did and why they did it to fix a single line code.

Having a live product is a full time job even if you change a single line of a code once in a while. It's fine doing it for fee(in other words on your parents dime) when you are a teenager or when it is a passion project, otherwise its abandonware or your life destroyer(which is abandonware with delay).

Other options exist of course, like giving away the product for free then selling its control to people with other motives(widespread among browser extension developers) or sell services around the product like cloud something AI something (this one is nice actually, just not applicable to all apps).

### Comment 164

> They abandoned their products once the growth stopped and/or switch to subscription and gave their one time purchase makers a year of subscription to make it up.

That's categorically untrue and if you're doubtful, I'd be happy to give you a list of wonderful software I've bought over the years for a singular license which has remained well supported and functional for years to come :)

I understand a lot of people are telling you the same thing here, but hopefully it will serve as a lesson. If you want any success in this space, you need to figure out your pricing.

> Having a live product is a full time job even if you change a single line of a code once in a while.

I run several live products and also hold a full time job. This isn't true.

> Other options exist of course, like giving away the product for free

I think this is exactly what a junior macOS developer should do if they want to get good enough to start building real products.

### Comment 165

Sure, I can I have the list? I wonder how the success looks like, maybe we simply don't agree on what a good business is. I'm strongly against get paid once support forever, I will skip on that success.

Are you by any chance an employee at a large corporation, working for them then donating your time as free apps or apps costing you more than bring in? If that's the case, I will skip this success too.

Are you talking from position of a business person who made more than they spent or are you working from position of a corporate philanthropist?

Anyway, I think you should just clone my app and sell it on your rates and on your terms. Everybody wins.

### Comment 166

Here are three I've bought in the last few months :)

- BettterTouchTool: <https://folivora.ai/buy>

- Synergy: <https://symless.com/synergy/purchase>

- Loopback: <https://rogueamoeba.com/loopback/buy.php>

Mertol, I'd encourage you to check out those apps, consider what the product does and the utility it provides, and then try and rethink the pricing on CrystalClear Sound to be more in line with what other professionals in the industry are doing. I hope that's helpful :)

Ah - I've seen your edit. It sounds as if you've already decided what you want and aren't looking for advice. Perhaps you'll get used to your idea of skipping success.

### Comment 167

I'm just trying to understand who is providing the advice. Are you giving an advice as someone who built actual business or are you someone who works in an actual business and donates his time and giving me the advice to do the same?

### Comment 168

You do realize you are on a tech forum?

>Having a live product is a full time job even if you change a single line of a code once in a while.

I have launched dozens of products and changing a single line of code once in a while is definitely not a full time job. Honestly, this makes no sense.

> They abandoned their products once the growth stopped

This is obviously false (take basically any popular app with a single license and look through their update log). Your stated reason -- fixing bugs or updating API usage for existing products -- should not require a subscription. Maybe it's an old school assumption, but I expect single line bug fixes to be included in the initial cost.

If this was an incredibly complex project that required years of research and development I could see some logic behind your argument. However, linking to a 50 line code snippet as your inspiration and explaining that you faced some challenges when building the production app does not look serious.

### Comment 169

Charge 80 bucks for small tools, or 800-6000 for other tools. And don’t forget to pay for upgrades

### Comment 170

This just in: people do things to maximise profit.

### Comment 171

I'm not going to compare this to a cup of coffee, as that analogy has been beaten to death. What I will say is that $20/yr is far higher than many apps, that are much more complicated, do a a lot more, and are self sustaining businesses.

Why would anyone want to pay 2x for this compared to what a really good podcast app costs? Or 7x what a good gif manager costs?

This app doesn't even do anything that native macOS tools can do for you with 2 minutes of work (aggregate audio devices, or a bit of scripting), and literally saves you from one extra keypress and 2 clicks.

### Comment 172

Third this.

I know ~everybody hates Adobe, but I pay about $120 / year for Lightroom + Photoshop, which are way, way, way, way, way (I ran outta "ways") more complex to build and valuable to me as a user than this.

### Comment 173

Second this. Would gladly pay a one-time $10, but $20 annually doesn't make any sense for an app like this.

### Comment 174

Add me to the list. I question some of the app subscriptions I do pay for, and those offer a ton more functionality for the same $20-ish dollars. This app doesn't even have a cloud server backing it, no way I'm paying a subscription at all for a utility app with no recurring infrastructure costs.

But to be more positive: I'd love to support an app like this, which I probably wouldn't even use that much these days; I just won't pay the current pricing.

### Comment 175

Sorry, chief. I've been a macOS dev for 10 years now. I think charging a subscription for a menubar app with a singular use-case is just the absolute worst.

"not one time payment because I don't know what would the right price be for supporting an app for years to come and still have people willing to pay for it"

The right price would be about $5-10. If you want to be kind, $0.

### Comment 176

I hear the feedback but no way I'm doing get payed once support forever or give away for free support forever. I've done these mistakes it the past, I might re-consider if I get rich or something and start donating my time to passion projects.

Even the simplest apps end up having problems, even the perfect one can break when something in the environment changes. Working on even the simplest app is always a full time job, not because you write code 40hr/week but because you need to have you attention on it, retain the information about the architecture and more importantly the "gotchas". If you don't, you will end up spending hours and days for the simplest things to study your code and re-discover everything again so you can work on it.

Or maybe that's just me, maybe other people can work on 10 projects making simultaneously and fix a code they wrote months ago in seconds. If that's the case, those people should make all the apps so we can use em for cheap or free and we can go do better things with our lives.

I can experiment with the subscription pricing though.

### Comment 177

If someone I employed said that something “is a full-time job because I need to keep myself familiar”, I’d really have to hold in my laugh of disbelief, to say the least.
You’ve taken the “people should pay ongoing for ongoing work” discourse and applied it beyond the degree to which most intend.
Even if I wasn’t already using a perfectly adequate and free menu bar application to do exactly this, there’s no chance in hell that I’d ever see an apparent lack of documentation ability as justification for an ongoing subscription for this.

This is all ignoring the fact that you’d very likely need to maintain this application in its entirety to continue scratching your own itch.

I pay for a lot of software, including subscriptions. I am almost always happy to do so. This is a rare occurrence where it comes across as a piss-take.

### Comment 178

I'm sorry, I can't switch from project to project at whim and keeping up with a project is something continuous for me.

Those who believe that it's a better practice to do it some other way should just do it. I've done my fair share of free apps, browser extensions etc back in the day. Not doing it again. I'm of course open to different business models where the app can be free and recoup the cost in some other way but so far haven't heard any suggestions.

It is alright if a project "fails" if I can't do free work or go through the agony of working on code I moved on long ago.

### Comment 179

>no way I'm doing get payed once support forever or give away for free support forever

Why do you keep saying that "support forever" is the default here? Nobody would expect that except if you were releasing under a subscription model.

Plus, this app doesn't need support. Come on.

### Comment 180

> Nobody would expect that

What is the source of this claim?

> Plus, this app doesn't need support. Come on.

And this one? If that's right why I'm working on bugfix now? Is it because of the subscription model? If it was one time fee, am I going to just ignore the bugfix requests?

### Comment 181

> What is the source of this claim?

Me, I guess. I've released MacOS apps for free and never felt any expectation to provide indefinite support. They do what they are supposed to do and people still use them.

> why I'm working on bugfix now?

Idk that's on you brother.

### Comment 182

Since this is hackernews, here's a free and open source version of the same that works from the statusbar.

<https://github.com/Gaulomatic/AirPodsSanity>

I didn't create this, but I do detest subscription models on bugfixes..

### Comment 183

> The technical reason is simple: Bluetooth has a low bandwidth

Nope. The reason is that to listen, Bluetooth uses the unidirectional A2DP profile, while the only two-way profiles are HSP and HFP from 20 years ago, which are monaural and favor low latency over quality, with an old codec and a passband filter focusing on human voice.

Forcing the mic to be anything but the BT one makes the stack move to A2DP (with infinitely better listening quality for you at the cost of a teeny bit of latency) and, well, a local
mic, possibly even an array if mics in the MacBook case (with infinitely better quality for the other side + ~zero latency)

If both ends do the no-BT-mic dance the quality is crystal clear + BT latency is only paid once (twice RTT) instead of twice (four times RTT)

On macOS one can option-click on the Volume menubar item and switch audio input in a pinch.

<https://en.m.wikipedia.org/wiki/List_of_Bluetooth_profiles>

### Comment 184

Love the app but you lost me at “subscription”. I would totally pay for major upgrades when fixes are indeed needed, but not per month or year by default.

### Comment 185

> I would totally pay for major upgrades when fixes are indeed needed, but not per month or year by default

That's one model I like too and unlike one time payment for lifetime support, it's sensible. However, there's no straightforward way to implement it. How do you do it? Ship all the versions every time and show the user the latest version they have a license for? Ship a "shell" which will download the latest binary the user is licensed for? Disable new features for users who purchased the app some time linger than the introduction of the feature?

I don't know, it adds a lot of complexity in the implementation, distribution, license management and working with Apple's rules.

IMHO it's much more sensible to have a low monthly fee and use it as long as you like it.

### Comment 186

The best model I've seen for this is to simply charge for major version upgrades. It's totally at the developer's discretion what they put into any given major/minor/patch version so you can demarcate development in whatever way suits.

### Comment 187

This has several downsides:

(1) If you purchased something just before the new version comes out, it feels like you got screwed over.

(2) It requires a lot of new features be released at once for the new major version. This is actually more difficult to develop for vs releasing one feature at a time.

(3) It makes planning and budgeting much more difficult, for users and for developers. If there is a bug (especially a compatibility bug for the latest annual version of iOS/macOS, or a security bug) affecting version N, version N-1, and version N-2, all will require bugfixes. This raises the cost of bugfixes. Not to mention potential bugs related to future physical AirPods products.

(4) It leads to bloat from gimmicky new features being added to attract new customers.

I'd much rather pay, say, $0.99 per month or $9.99 per year, and get regular compatibility and security updates, and know that this developer will not go out of business, compared to paying $50 for a product I might not actually use very long if it won't work on a new computer.

If you want good software that gets regular updates, bugfixes, and compatibility updates, it's best time to pay for it on a regular basis.

### Comment 188

I don't know why this is downvoted. All good points, thoughtfully presented.

### Comment 189

Honestly what new features would realistically be added? These are those kinda utility apps that the end user should forget even exists. You do an update if a major OS version breaks it. Should be very low maintenance.

20 bucks a year for something that toggle a mic input is very expensive.

### Comment 190

>Honestly what new features would realistically be added?

The features currently on my todo list if people keep using the app:

1) Currently the profiles are for AirPods exclusively, add generic support for other Bluetooth headphones.

2) Add support for custom profiles. For example some people might have many microphones and prefer different setups.

3) Improve continuity support by detecting user leaving the computer. For example, the user might be on a call and get to the other room and in that case it would be appropriate to switch to AirPods mic.

### Comment 191

The first one or per feature

### Comment 192

I really feel this isn't the devs fault, it's a product of the accursed App Store payment model.

The issues I see:

\* Devs can't make paid upgrades: to make a paid upgrade the options are a new app, except the security model for the apple app stores ties a lot of things to the app id, so a new app disconnects the user data from the old app. To keep the information tied together the "solution" is subscription or in app purchases (which also means you essentially have to have your app contain multiple versions embedded and you base what actually loads based on user purchases).

\* Devs can't do free trials: again the option are subscription or in app purchases.

The alternatives are subscription or in app purchases, but there's no way for a user to distinguish an app that has those as a mechanism to support upgrades from a bait-and-switch app: As a result if an app is listed having either I generally don't consider installing it (esp. if it requires an initial payment) which is unfair to the reasonable devs but there are so many bait and switch apps nowadays (App Store review technically has a lot of value, but that this kind of BS is allowed remains a plague and substantially undercuts the benefits).

### Comment 193

I do the same - if an app is "free" but has In-app purchases, I'll simply avoid it, even if I'd be willing to pay some price for it if it works. I don't have time to download every app, open it, and navigate to its pricing page to see how much it costs.

You should be able to see the name, description, and price of all the in-app purchases from the App Store.

### Comment 194

I’m not sure about the Mac OS side, but at least on iOS there’s a specific entry in the information section for in-app purchases that can be expanded into exactly that pricing list.

### Comment 195

But it's always listed as something like "Premium Features" or "Monthly Subscription." Those descriptions don't tell what I'm getting. So then it's usually download the app, try to figure out which are the premium features and which are baked into the app. It's a mess. And I get it, it's not really the dev's fault, but the system is completely broken.

### Comment 196

Well there you go! Thank you!

### Comment 197

Affinity managed this just fine. Release the first version. Then the second version is a new product on the App Store.

Not complicated.

### Comment 198

I solved this problem six years ago although I quit apple since and you have to update/compile it for yourself :
<https://github.com/milgra/airpodssoundqualityfixer>

### Comment 199

Thank you! Does the 2020 release binary not work?

### Comment 200

Excellent! Great job.

### Comment 201

This is great! I've been needing a solution to this problem. However...

I would pay $20 one time for it. But a subscription is a deal breaker.

My guess is you'll make a lot more revenue by doing one time fees tied to a specific AirPod version. So each time I upgrade my AirPods, I pay a new one time fee instead of the subscription.

### Comment 202

+1. As much as I realize that the developer may think their app is important enough for consumers to subscribe, from consumer perspective there are 30 other things that I would love to use -- which ask for subscription as well -- and I will probably subscribe to top 5-10 of those. Particularly $25/year is quite high for what it does, and it would definitely not make it to that list.

On the other hand perpetual license for $20 is something I would definitely consider. You can release V2 after 2-3 years and people can choose to upgrade if they find the value.

### Comment 203

Fair points. I just think you'll make more charging a one time fee as most people won't want to do a subscription. Either way, I'm guessing it will be hard to make a full time income off a single utility app. But if you have plans for other related apps, then lowering the price of one app to use for lead gen to upsell to other apps seems to work pretty well for app devs.

Best of luck!

### Comment 204

Thanks! Much appreciated.

Unfortunately I don't see how 20$ one time fee will works for such a niche app. After commissions and taxes $20 becomes $10.

Anywhere in the developed world the money required only to survive is at least 2000$, which means I will need to be selling 200 copies every month as long as the app exist only to get basic level of income and accumulating customers that I will have to support the years to come. What happens if the next year sales drop to 100 a month? It will become an abandonware and make me enemies or eat up all my time for nothing. Many years ago I purchased Halide and later it become a subscription app, I felt deceived and still hold grudge and I don't want to be that guy. It's subscriptions right away and have only the people who think that 2$ a month is a fair compensation for the service.

One time payment is either paying for abandonware, charity or scam.
With subscriptions, it's a service. It's the best for everyone. Some people associate it with greed but I don't agree that expecting getting paid for work is greedy.

### Comment 205

> *I will need to be selling 200 copies every month as long as the app exist only to get basic level of income*

First of all, it's probably an unrealistic expectation that a small utility like this should be able to provide you with a basic level of income.

Second, in terms of pricing, you seem to be trying to make moral arguments about greed and scams here. But you should simply be realistic about the demand curve, and try to maximize your profit. If there are a lot more people who would buy this as a one-time purchase than as a subscription, you'll be losing money going the subscription route.

### Comment 206

I'm not really interested in maximizing my profit, I simply don't want a burden. If people like it, use it then they pay for it and I take care of the app and if not the project dies off without me having to support potentially thousands of customers for years to come.

### Comment 207

Let me start by saying that I wish you the best of luck and success with the app.

With this said, I have many subscriptions that "costs less than a coffee per month", to use a popular excuse. The problem is that I pay $3 here, $5 there, $7 for this, $10 for that... and when I add it all up, it's a lot of coffee, if you know what I mean. And at this point I don't see why I should pay for a program that will work without your intervention while I'm running this macOS version (or even across multiple macOS versions). I'm not using any of your resources/time or costing you any money.

I completely understand that you want to be paid for your time if something breaks and you have to fix it, but you don't need a subscription for that. Some apps give you x years or x macOS updates for X dollars. After that, if you want a new update, you pay for another x years/pay for the latest major update (or something like that).

If this used any server side stuff or required regular updates, then I would understand the subscription. As it is, it's a bit like Adobe software... I don't need it enough to pay for the subscription.

### Comment 208

> ome apps give you x years or x macOS updates for X dollars. After that, if you want a new update, you pay for another x years/pay for the latest major update (or something like that).

I know, I actually like that model too. It's just that there's no straightforward way to implement it. If Apple offered such model, I would pick it at heartbeat.

Currently, such a thing will add so much needless implementation complexity to such a simple app. It's just too much of an effort for a side project-turned-commercial-product.

### Comment 209

> One time payment is either paying for abandonware, charity or scam. With subscriptions, it's a service.

This isn't a service, though. It either does what it says, in which case why do I need to keep paying for it? Or it doesn't, in which case it's just like a warranty claim or similar. There's no ongoing expectations here. It's a product that you're charging service fees for, that's just completely out of whack.

Like this genuinely would be better as "abandonware" (read: product) with a single $5-10 charge.

### Comment 210

Are you implying that developing this software and maintaining it is a full time job?

I'm not saying it's not, I'm actually curious.

If it is indeed a full time job I don't think it's worth the time investment required to be perfectly honest. :\

### Comment 211

It is a full time job even when you have a single user, you can't just get the payment deliver the app forget about it. It doesn't work like that, bugs happen the environment changes etc. People don't simply shrug and go buy a new software, they expect the thing get fixed.

### Comment 212

But do you have to work on the program for forty hours a week or four?

### Comment 213

How much do you think is my fair price? I will leave it here because it's weird to higgle on it. If I'm going to be "on call" I expect to get paid and I don't think this is greedy or unreasonable.

### Comment 214

the going rate for a freelancer is $100/hr in my part of the world, but you can check your going rate.

You can calculate your expected baseline yearly sales from this, based on how many hours you expect to work bugfixing and improving things on average per year.

You can timebox the work- having a half-dozen services like this is exactly how Panic Inc. came to mass prominence.

Everything depends on the actual amount of time you have to spend on the app, nobody is asking for minimum wage work, that's totally not fair; but perhaps expecting this single project to support you full time is unlikely.

The upshot is that if you're more successful than your baseline, that's "profit", and it's unbounded.

### Comment 215

I think you should just release an app that does just that at your rates.

### Comment 216

<https://github.com/milgra/airpodssoundqualityfixer>

### Comment 217

Someone should put it on the AppStore or compile and release it for immediate download instead of demanding I give away my work and time for free. Everyone wins.

### Comment 218

Nobody is demanding this.

I’d recommend stepping away for a while and coming back with fresh eyes. Imagine that we’re all being honest and not trying to bring you down- because genuinely we’re not.

There have been a lot of comments about the pricing, specifically the subscription, so its best to see what you can take from that. But that cant happen if you’re emotional about it because you will naturally be defensive and your mind wont let the constructive elements in.

### Comment 219

Fair enough, maybe your are right and I get worked up on the backslash for subscriptions(though I totally expected that).

### Comment 220

I do not think anyone is demanding anything of you. They are offering feedback on your (IMHO) suboptimal pricing strategy. You have every right to disagree, ignore them, etc. But if you really feel that someone is demanding something, perhaps you should take a moment and cool off. I do not read any messages here as a demand on you at all.

### Comment 221

Fair enough. But I won't be ever doing one time payment or freeware. If I abandone the app I will put open source it.

### Comment 222

Who says I haven't?

### Comment 223

Good for you then.

### Comment 224

I get this app and I will use until my devices no longer receive updates (~7 years). Now I'm stuck giving you (and Apple) money forever. I don't care about any features you may want to add, so the version I originally "buy" is the version that will serve me until I upgrade my hardware.

This is the problem with subscriptions for apps without services - If I stop paying, I lose access to what I already have. That *sucks*. So begins the treadmill of money leaving my pocket and entering yours (and Apple's) for no good reason. I will find it even more grating when whatever features you do add to the app I don't care about and will never use.

Just let me pay you for your work and we'll go our separate ways.

### Comment 225

I can understand this logic, but does every app generate enough revenue to sustain a developer full-time? I would think that some niche apps are able to bring in solid revenue for the amount of work put in.

I'm unsure how much time would go into general upkeep and management. Could some of the others suggestions here work, asking users to pay for future updates?

I'm in the same camp as most of these users. I have this problem while using Discord and a game on STEAM (Counter-Strike). The mic quality is degraded heavily and I would be more than happy to pay a one-time fee. But I do not like adding too many subscriptions, no matter the cost, especially for apps that I could see myself requiring no serious updates unless I upgraded my physical products.

### Comment 226

I think the issue these days is that so many VC funded companies give away products for free to essentially capture the entire market so no non-VC funded can compete with that, or numerous "free" (ad supported) or in-app-purchases funded competition (the ad supported ones frequently being just direct clones of other peoples work) force the purchase price down below the actual development cost.

People now believe apps should be free, or cheap enough that they don't cover the actual costs for people who are doing the actual development costs.

I'm not sure what the real path forward for developers in this environment - if you charge the necessary amount you're undercut by separately funded products or ad supported apps, if you charge a "competitive" amount you can't live off it, if you have a subscription that supports ongoing dev people say "I only want to pay a single time".

None of this helped when you then have asshole game devs that sell games for $100+, but then throw in constant in app purchases and DLC for basic functionality that used to be part of the game.

### Comment 227

Oh I can't agree more.

When the VC money was sponsoring everything, everything's price has become free and today they are recouping their investment and people begin talking about "enshittification". Free(as on free beer) software was simply a predatory practice to shape the market in certain way and prepare it for exploitation.

### Comment 228

I don't expect it to generate full time job level income, all I expect it not be a burden.

I used to make free apps, browser extensions and so on. Dropped everything because it becomes full time job and if its going to be a full time job I must be compensated accordingly.

I'm no longer a teenager and my time is no longer paid by my parents. It's possible to have other business models where the software is "free" but on this particular case I don't see how it can be. Transcribe all the user audio and share it with advertisers? Please no.

### Comment 229

I completely agree that you must be compensated. I don't think anyone is telling you to share this for free, in fact, a lot of people are stating how they would be happy to pay for it.

It makes sense that a collection of apps, extensions, etc would become a full-time job that demanded full-time compensation. I think the disconnect people are having would be, how could a single app demand that?

Either way, it's your prerogative to do as you'd like with your app. I wish you the best of luck as it's a really neat sounding app.

### Comment 230

I think whoever think that the price is not right should just not use it. Unfortunately the VC money that was flowing in last 20 years degenerated the expectation of everyone and once the investors begin recouping people begin talking abut "enshittification" but can't come around and pay for the services they use or not pay and not use.

This is not a VC funded project, this is something I made for myself and got the idea to put it on the AppStore.

### Comment 231

Same can be achieved in a few lines of Lua using Hammerspoon and hs.audiodevice API.

```
    local builtinMicName = "MacBook Pro Microphone"
    hs.audiodevice.watcher.setCallback(function(e)
        defaultMic = hs.audiodevice.defaultInputDevice():name()
        if (e == "dIn " and defaultMic ~= builtinMic) then
          local builtinMic = hs.audiodevice.findInputByName(builtinMicName)
          builtinMic:setDefaultInputDevice()
        end
    end)
    hs.audiodevice.watcher.start()
```

It doesn't seem fair to pay $20 per year for this. I'd be fine with one time payment.

### Comment 232

Cool solution! But have you actually tried it?

Once you try it you may find out that for some reason sometimes it will revert back to AirPods mic. I filed a bug report for that, check it out: <https://developer.apple.com/forums/thread/763583>

Therefore you will have to iron out the edge cases. Are the AirPods considered connected when you switch to your iPhone when using your Mac? Yes the continuity stuff.

Also, you will have to actually maintain that script. That is, you will need to find a place for it where it lives and it’s not lost when upgrading the system etc.

My app is for all the people who don’t want to deal with this and rather pay $2 a month to have it maintained and have someone they can report the issues they have and get them fixed.

Anyway, I made the app for myself and decided to put it on the market to see what happens, so it’s alright to have a competition:) if it happens that this is the better solution I may just drop mine and use it.

### Comment 233

Yes, I have used a similar Hammerspoon script for nearly 10 years.

### Comment 234

Sorry if you felt attacked, it wasn't my point.

Congratulations on developing and shipping a fully-fledged product, I hope I'll help people in need of a "it just works" solution for this particular problem. Paying for it is of course justified, as you poured your time and knowledge to provide a fully working fix.

Since this is Hackernews, I shared how I approached this problem on my devices - I use Hammerspoon to script little parts of the system I don't like in macOS and audio device handling is one of them.

I use a more complex version that handles additional pain points, but the default input source changing has worked just fine for me for the last few years (with AirPods, Bose QC35 and regular wired headphones).

### Comment 235

Oh you don’t have to be sorry, I genuinely liked your solution. I haven’t tried lua, looks much simpler than what I got with Automator for example!

I was expecting a backslash for not giving away for free, kind of enjoying it. Like the good old days when I was making free apps for the likes but this time I’m on the “dark side”

### Comment 236

Is there any chance you could share the more complex version?

### Comment 237

The script can be extended with additional features like:

- fixing macOS balance bug (outputDevice:setBalance(0.5) on output device change)

- muting built-in speakers on headphones disconnect event

- pausing Spotify when external headphones are disconnected

### Comment 238

You could charge $10/year for this to compete with OP.

### Comment 239

I love Hammerspoon so much and love seeing snippets like this come up.

### Comment 240

Well, one thought about your pricing model - you’re thinking that it might need work in the future, but you’re charging each month without delivering any additional value to customers. How about charging additional money for each new major version, corresponding to either new feature development or support for new versions of the OS?

### Comment 241

This is a big issue with the App Store. Either you charge a subscription or you charge a on-off and all upgrades are free forever.

### Comment 242

That's definitely not the case, Apps can lock new features behind IAPs and keep charging for new features while sharing bug fixes.

### Comment 243

Oh wow, I actually had no idea that was the case. That definitely throws a wrinkle into things

### Comment 244

Why can you not create a new app with a similar name but name it v2, 3, etc?

Things and many others did this.

### Comment 245

How do you implement that?

### Comment 246

The Due app does something like this.
Basically it’s 1 time fee + subscription.
The day you buy the app, you get every new feature for the next year and every previous feature.
If a new feature is added, you can subscribe for $5 a year. Upon subscribing, you get all new features since your subscription lapsed.
Blog post here: <https://www.dueapp.com/blog/future-of-paid-upgrades.html>

### Comment 247

Loopy Pro does this as well.

### Comment 248

I don't think App Store supports that. But if you're interested, it's a planned feature in my macOS license management SDK (padlockSDK.com - pricing is placeholder, its free until I know if it's of interest for people).

### Comment 249

Thanks, I will check it out

### Comment 250

I don't mind subscriptions at all, I pay for tons of them and am happy with them, but it's egregious to me that this would be a subscription.

### Comment 251

I hope they introduce a cheaper plan for just a single earbud /s

### Comment 252

Freemium version may get you left only… also pipe ads in. Sub gets you ad free (for now) and both buds!

### Comment 253

Sorry to crash your launch but this is supposed to be fixed in the new version of MacOS Sequoia + AirPods 2

[https://www.headphonesty.com/2024/07/apple-solves-bad-airpod...](https://www.headphonesty.com/2024/07/apple-solves-bad-airpods-call-quality/)

I'm still on Sonoma for work reason so I didn't test it.

### Comment 254

IIUC, what Apple is doing is reducing the number of active channels, so they can keep audio streaming at 48kHz in mono. OP is claiming better audio out quality, which to your point will be unnecessary with the new update, but also better audio in quality by always forcing the external microphone to be the default source, since it's not constrained by the BT bandwidth and is of overall better quality than those of AirPods.

I also think that by doing this, BT audio out can be in stereo/48, which is arguably "better" than mono/48, so their app is still useful.

I personally wouldn't subscribe to it, though. The script OP mentioned on their post seems sufficient for my use case.

### Comment 255

Got time to test it and it works.

2 Ch 48kHz for output and 1 Ch 48kHz for input while using Airpod 2 on Sequoia. Be aware that the app must request a high bitrate for this to work.

Example: you need to use Safari for Google Meet. It doesn't work with Chrome.

### Comment 256

I would be happy if its fixed! I'm on Sequoia 15.1 and it's not fixed yet. This is not exactly my million dollars idea, just a side project I made for personal use decided to see what happens if I put it on the AppStore :)

Fingers crossed it gets fixed.

### Comment 257

23€ per year for an automatic source switcher ? I understand it might be more tricky that it looks, but it's more than I am willing to pay, event for a lifetime license.

### Comment 258

I guess the target audience is audiophiles that are willing to pay $100 for gold plated connectors.

### Comment 259

On the other hand, true audiophiles wouldn't be caught dead using Bluetooth headphones anyway. 256kbps AAC? Only 44.1 kHz!? The horror!

### Comment 260

Ah, those audiophiles? If anything, that's the perfect opportunity to sell them some [orders of magnitude overpriced] essential oils diffuser with proprietary pouches with... uh... gold nano particles to improve lossless signal transmission over the air.

### Comment 261

The target audience is people who don’t want to deal with this stuff and have their sound working as expected and don’t bother to pay $2 a month for it. It’s not free because freeware also requires to provide support.

### Comment 262

I like your particular brand of snark.

### Comment 263

It't the second lowest monthly price point for subscriptions and I thought that dropping 2 months off on yearly pricing is nice: [https://a.dropoverapp.com/cloud/download/df0874fb-2800-4d2e-...](https://a.dropoverapp.com/cloud/download/df0874fb-2800-4d2e-b25c-cd8e7b2c90f4/e4692a61-b58c-417b-830e-a011fc84d2be)

It's an extremely niche product, if I end up getting 1000 paying users, I will be making about 1000 USD/month from this after Apple's commission and sales tax.

I don't expect to have that many users, honestly. So if it happens that I get a few hundred paying users I can pay a freelancer to improve on the app occasionally or rationalize spending time on this fixing bugs and adding features.

Also, it's completely optional app that is for convenience only. As I explained, the same effect can be achieved by manually changing the input source from the settings or write and setup a script to automate things.

### Comment 264

I didn't meant to undervalue your work, you are entitled to your pricing. I shared my perceived value, and for wrong reasons, I'm just frustrated because I've been looking for this exact usage for a long time, and I just can't find rationale spending that much only for convenience.

Note, for your marketing, I can't recommend your app at that price, but at low enough price I would recommend your app to all my coworkers at each bluetooth hiccups, because just as you state, mac microphones are much better, and I hate suffering bad microphones.

### Comment 265

Fair enough, if it turns out that tens thousands of people are interested in the app and not much support requests are incoming I can re-consider a lower price point.

It's possible that another price point or model yields better results. Thank you for your feedback, I will look into it.

### Comment 266

I'm not going to compare this to a cup of coffee, as that analogy has been beaten to death. What I will say is that $20/yr is far higher than many apps, that are much more complicated, do a a lot more, and are self sustaining businesses.

Why would anyone want to pay 2x for this compared to what a really good podcast app costs? Or 7x what a good gif manager costs?

### Comment 267

Do people really pay a subscription fee for a podcast app or gif manager? Good god, what has become of monetized XML documents!

### Comment 268

Free alternatives:

- Intel (also works in rosetta): <https://github.com/milgra/airpodssoundqualityfixer>

- Apple sillicon native: <https://github.com/Gaulomatic/AirPodsSanity>

### Comment 269

From the README.md of the second tool.

> What it doesn't do

> This piece of software is not cloud-native, has no micro service architecture, did not follow DDD principals, contains an algorithm designed by a fool, can not scale (neither vertically nor horizontally) and abuses your sense of humor

### Comment 270

Thank you, I should study those and see if I can “steal” ideas for my product! My customers deserve the best solution out there :)

Does this issue have a common name? I had hard time finding a way to fix it, ended up building a solution myself. Maybe my Googling skills got soft.

### Comment 271

If I press the option key of the Mac and clic on the speaker icon of the menu bar, I can select the source of the speaker and mic as well.
Am I missing something here ?

### Comment 272

It's a convenience app, doesn't do anything you can't do by yourself. That's how I used to do it, got sick and tired of doing it every time I connect my AirPods and made an app to make it happen automatically and put it on the AppStore to see if others can find it useful too.

### Comment 273

Okay I get that but for a « click away », a subscription of that amount is really too much compared to other amazing apps that I use every day. For example, I can make screenshots with MacOS a clic away. I bought Shottr because it’s a convenience app and I use it hundreds of times per day and I save a tremendous amount of time and clics to edit screenshots. But it’s $8 once and does a LOT with many great features

### Comment 274

I don’t believe in single payment apps, developers miscalculate and ask for a single payment and they collect some money once and they have to support it for years to come. They later abandon the app or fix it but fixing is’n nice, I’m still bitter with the Halide developer because I purchased the app only for it to become a subscription app. Now I don’t get the new features and tell people to watch out for their new Kino app. I feel deceived.

I don’t see how I can be “booked” for years unless I make at least a few 100K’s from this. I don’t actually expect to have more than a few 100 paying users, this is a niche app.

I probably should have been charging at least 9.99$/month to make any financial sense based on my low expectations but since this is a subscription app at least I can discontinue the app without screwing up people if I have to abandon it.

### Comment 275

I completely agree, I gave Shottr as an example. I also have a lot of subscriptions I’m not at all against it. But you gave the example of Kino, I imagine that the skills to develop such an app is quite high and even if they would be 15$ per year or more it would be worth it. But if a « click away » app kind of skills, my personnal preference is more like a sub 10$ a year. Like, I have smoothScroll, I pay a subscription every year and I don’t mind paying 8€ for it. 20€ ? I never would have tried the app

### Comment 276

Pricing isn’t really about $/hardship. If you actually deep dive into it, you’ll find that the correlation is very weak.

If this was some kind of app that millions would use, I guess I could have given it for free for exposure or make it very very cheap like 1$/year but I don’t think that this would happen. Now my bet is that if I can get 1000 paying users I will keep the app around and develop it further by spending time on it.

I have some more ideas. I’m currently marketing it as an app for solving this specific issue but it’s also a nice input/output switching app. Maybe it can be the app that solves all the sound issues by always setting the correct input/output? You know how there’s always someone having trouble with their sound when on call. Let’s see.

### Comment 277

It’s right, pricing is really subjective and I said « personally » because it’s my perception of the matter.
I really hope people will pay what you charge and you will get traction. Too much people are used to get software for « free » like it has no value and I don’t agree with it. I hope the best for you !

### Comment 278

A subscription for an app that fixes what is considered a minor annoyance?

It’s a menu bar app at best. This should be a one time payment. If maintenance is required for future macOS versions, then publish new app and charge one time fee.

Many app devs use this same model with success (rogue amoeba comes to mind).

Don’t be greedy

### Comment 279

> This should be a one time payment.

> Don’t be greedy

Pot meet kettle. The dev says they need ongoing cash for ongoing updates, and this message here instructs them to charge less.

### Comment 280

I appreciate the effort (and unlike others, I like the lengthy explanation and supporting links), but you lost me at subscription. The model is untenable for the (average) consumer and I can't in good conscience support an all-rental future, however small this step may be.

### Comment 281

I guess you need a subscription for everything these days

### Comment 282

Hey, your comment just got a reply, if you want to read it please subscribe to Hacker News Plus for just 1.99 an hour. If you spend less than an hour a day procrastinating here, then it's free. But we all know that's not the case.

### Comment 283

And then you sign up and the "comment" was just some scammer who's account has since been deleted.

### Comment 284

But don't forget, if you signup for the premium+ you will get one free boost each month, so your post will be on the front for up to 30 minutes and it will be seen by more people!

### Comment 285

$20 per year subscription? That seems pretty steep for what the app does.

### Comment 286

Remember when you could just *buy* a piece of software and not have to keep paying rent to use it?

### Comment 287

How much of that is being „forced“ by competition and the free market?

More apps doing roughly the same but none doing anything well or exceptional well? Yet resources become more spread and hence sparser?

### Comment 288

I often manually switch to the built-in mic of my MBP [edit: while using Airpods for audio output]. To switch more quickly, I found that when you alt-click on "Sound" while in the Control Center, you can select audio devices for input and output independently of each other.

### Comment 289

Looks good but no way I'd pay a subscription for a utility.

### Comment 290

do you use the utility on a recurring basis

### Comment 291

There are other apps out there that do this e.g. ToothFairy <https://c-command.com/blog/2024/03/06/toothfairy-2-8-4/>

### Comment 292

Thanks

### Comment 293

> CrystalClear Sound requires a paid subscription(a rather cheap one), which supports the development of the app.

Sorry, but I'll pass.

I'd spend a few dollars on a convenience app like this as a one-off purchase (it would save me from option-clicking the volume icon every once in a while), but what ongoing development or infrastructure am I paying for with a subscription here?

### Comment 294

There's no ongoing development, he wants the recurring revenue to build a cash reserve so he has the option to hire a freelancer to fix bugs or implement new features if they are needed, if not then he just keeps the cash.

edit: I'm not condoning nor condemning OP's monetization strategy, I'm just summarizing what he has explained on the original post and subsequent comments.

Direct quotes:

> I suspect further development might be needed as bugs emerge or API behavior changes

> It’s not free because freeware also requires to provide support.

> if it happens that I get a few hundred paying users I can pay a freelancer to improve on the app occasionally or rationalize spending time on this fixing bugs and adding features

### Comment 295

Why would that not be possible using a one-off purchase?

I really have a much higher understanding for things that run server infrastructure or require frequent work to keep up with things like changing third-party APIs or scraped websites.

But this is literally an Apple-hosted app using a stable API.

### Comment 296

I think you may be underestimating the volume difference in paying users you're likely to get with a one-time vs subscription model. Looking at similar apps on the market, I suspect you would earn more revenue overall with a one-time payment (many more users paying slightly less each).

### Comment 297

This is an important point OP should consider. While I defend his position and right to choose the pricing model that makes the most sense for him as a dev, and I personally don’t think $20/yr is very much if it solves a pain point, this is a valid POV to keep in mind that he may actually be leaving money on the table going an all subscription route. It sounds like he is also being limited by the kinds of pricing models the App Store supports (i.e. only subscriptions)

### Comment 298

> it's not one time payment because I don't know what would the right price be for supporting an app for years to come and still have people willing to pay for it

I dislike this very, very, very much. You do realize that with this attitude, we'll soon be bickering with our toilets to please let the seat down without making a small 4$/month in-loo purchase first?

### Comment 299

But since when has a toilet ever required ongoing maintenance by the manufacturer to remain functional in the environment around it? In this case the dev will have to provide updates and bug fixes, committing him to a level of work in perpetuity, whereas the toilet maker builds the shitter and never has to work on it again.

### Comment 300

Fine, fair point. Then at least adopt the thing jetbrains for example does: buy this version now, get x months of updates.

### Comment 301

:)

Yeah that’s a model that most people seem to like, and I would agree it helps soften the blow by providing some ongoing value for a set period of time.

### Comment 302

If Apple sold their own toilet, you can damn well be certain you'd pay a per-shit fee as their customer. This is exactly what you get supporting a platform that relies on monetizing it's users.

### Comment 303

Weird comment. I have three or four Apple devices at the moment and I don’t pay Apple a subscription fee for anything, let alone pay-per-use fees.

### Comment 304

It would be less weird if there was any feasible strategy for releasing an app that Apple doesn't take a cut from. Unless you pay for 0 apps, you are supporting Apple with recurring service revenue.

### Comment 305

Subscription? Is that necessary?

### Comment 306

You're not forced to subscribe tho, i sure won't.

Everyone is entitled to set their own price for their product, the issue is 'will people buy it?'.

### Comment 307

Please give a pay once option.

This is a tool to fix a problem, I don't want another tiny marriage.

### Comment 308

If this is as effective as you claim it to be, then I look forward to Apple including it in the operating system for free in the future. You should consider applying there and making it happen!

### Comment 309

This really should be a one-time-payment, not more subscription / rent seeking.

# 【2026年7月】各OSでのBluetooth LEAudioへの対応状況

## 来源信息

- 原文标题：【2026年7月】各OSでのBluetooth LEAudioへの対応状況
- 作者：Toshiaki_Ha5491
- 发布与页面标注更新时间：2026-07-02 15:00（日本时间）
- 原始网址：https://hikkie.hatenablog.jp/entry/leaudio-ready
- 获取日期：2026-07-17
- 原文语言：日语
- 来源性质：社区技术文章；不是操作系统厂商或 Bluetooth SIG 的官方兼容性声明。
- 完整性：正文、脚注和正文引用链接已完整取得。
- 清洗说明：删除站点导航、目录、广告追踪像素、推荐区、评论入口和页脚；省略不承载技术证据的题图；产品推广链接保留产品名称，去除广告展示像素。正文措辞、限制、推测语气和数值未改写或翻译。

---

2026年7月の現況に合わせてリライトしました。

### LEAudioおよびLC3、LC3+の概要

Bluetooth LEAudioはこれまでBluetooth2.1+EDRというレガシー仕様で実現していたBluetooth クラシックオーディオに取って代わる、将来の新標準となるBluetooth オーディオです。これまでよりも低消費電力で、これまでよりも低遅延のオーディオを実現します。

これは通常、クラシックオーディオの標準であるSBC コーデックと比較しての話であり、新標準のLC3 コーデックは現在実質的な標準コーデックの地位にあるAAC コーデックと比較して、大きく音質が向上しているわけではありません。

理屈上のアルゴリズム遅延は大幅に削減されていますが、それでも理想値で60ms程度のエンドトゥエンド遅延があり、ビットレートやオフロードの方式、製品によるディレイで300ms以上の遅延が発生することもあります。音ゲームやFPS・TPSのような、インタラクティブ性の高い用途で使い物にならない点に変わりはありません。

LC3の上位コーデックであり、音質面もハイレゾ相当に向上するLC3+に用意された、超低遅延（ULL）モードでは最低20ms程度に遅延が抑えられるとしており、遅延に敏感な用途ではULLモード搭載製品の使用が推奨されます。既存の2.4GHz帯無線は遅延について公称していない製品が多いものの、実測してみると30ms程度の遅延はあるものが多い印象です。より遅延を排除したい場合は赤外線を使用するものが望ましいです。

消費電力の話をすると、もっとも低消費電力とされるAACよりLC3のほうが電力消費は大きくなるのではないかと思われます。じっさい、[SONYが公開しているLinkBuds Sのヘルプ](https://helpguide.sony.net/mdr/linkbudss/v1/ja/contents/TP1000536104.html)ではAACよりLC3の再生時間のほうがノイズキャンセリング・外音取り込み有効時に0.5時間だけ短くなっています。[TechnicsのAZ100](https://jp.technics.com/support/download/operating-instructions/eah_az100/eah_az100_pnqw6269za_jp_si_s.pdf)（PDF）などは、ノイズキャンセリング有効・AACコーデックの約10.0時間からノイズキャンセリング有効・LC3コーデックで約5.0時間に半減してしまっています。

LEAudioはBluetooth バージョン4.0以降の規格であるBluetooth LE（LowEnergy）の名前を冠していますが、実際にはBluetooth 5.2コア仕様に準拠するアイソクロナス転送およびEnhanced Attribute Protocol（EATT）を利用するものです。このため、ソフトウェアの対応状況を問わずに最低限Bluetooth アダプターがBluetooth 5.2以降のコア仕様をサポートしている必要があります。製品の公称Bluetoothバージョンが5.2以降であっても、この2つの機能がなければ、LEAudioは利用できません。

また、これまでのBluetooth/A2DPで使用されるコーデックはソフトウェアスタックとして分割して提供されていましたが、LEAudio サポートにはスタック全体を交換する必要があり、作業量が多くシステムの安定を損なう危険性が伴います。

LEAudio Readyとして様々なチップが流通しましたが、メーカーによる明言があるものを除けば今後のアップデートで利用が解禁されるものは少ないと思われます。

#### LEAudioとSONY

LEAudio規格の制定について、元々は補聴器をBluetooth ワイヤレスとした場合Bluetooth Classicでは消費電力が大きすぎるということで、補聴器業界からBluetooth SIGにアプローチがあったことで企画が立ち上がったそうだ。

その後、ワーキンググループを立ち上げたところ、その音質向上・低遅延性・低消費電力に関心を持ったコンシューマーオーディオメーカーが参加してきたことで現在のように補聴器以外のコンシューマーオーディオデバイスにも規格が開放された。（参考：[ASCII.jp：LE Audioの始まりは補聴器に向けた低消費電力通信、Bluetooth SIGのキーマンに聞く (1/2)](https://ascii.jp/elem/000/004/164/4164299/)）

このコンシューマーオーディオメーカーというのは、おそらくSONYのことを指すメーカー群と見てよい。[AV WatchのSONY担当者へのインタビュー](https://av.watch.impress.co.jp/docs/series/dal/1414684.html)や[Bluetooth JapanのSONY紹介ページ](https://www.bluetoothjapan.com/sony/)などでもSONYの関正彦氏が規格策定メンバーとして活動を行っていたことが挙げられている。ゲームハード屋としてのニーズがあったためだろう。

LEAudioの実装に当たってはまだ実験段階の部分が多く、その挙動はメーカーや製品によってまちまちだ。安パイの製品が欲しい場合はSONYや初期から製品化に取り組んでいるJBL、プラットフォーマーとして早い段階から製品への実装に取り組んでいるGoogleなどが無難なメーカーなのではないかな、と個人的には判断している。

### 対応ヘッドフォン/イヤフォン

既に複数の大手メーカーからLEAudioに対応する製品が発売されています。いずれも最初から対応済み/アップデートで対応済みです。

一例の抜粋ではありますが完全ワイヤレスイヤホンでは、

- SONY WF-1000XM6
- Technincs（パナソニック） EAH-AZ100
- JBL LIVE BUDS4
- [Google Pixel Buds Pro 2](https://store.google.com/jp/product/pixel_buds_pro_2?hl=ja)
- [Google Pixel Buds 2a](https://store.google.com/jp/product/pixel_buds_2a?hl=ja)

ワイヤレスヘッドホンでは、

- SONY WH-1000XM6
- JBL LIVE 680NC

といった製品が挙げられます。

どのようにLEAudioを利用出来るようにするかの実装が個別の製品によって異なっていて、Bluetooth デバイス名（MACアドレス）をクラシックオーディオとLEAudioで分離している機器、コンパニオンアプリからヘッドフォンをLEAudio 優先モードに切り替える機器、ユーザーが接続モードを切り替える手段は用意されておらず、親機とのネゴシエーションで一番良いと判断した接続を自動的に選択するもの、クラシックオーディオへの対応を完全に排除した、LEAudio専用の製品も存在します。

また、LEAudioの低遅延性能を重視したチューニングが施されているのか、クラシックオーディオでもあまりディレイを取らず、接続安定性が弱いと評価されているものも散見します。製品仕様、市場評価を把握した上で購入されることをお勧めします。ハードウェア的にはLC3に対応したけれど、コンパニオンアプリがLEAudio接続時に機能しなくなってしまうものも多いです。

### Windows 11/10

Windows OSにおいてはWindows 11 バージョン22H2の5月CリリースにおいてLEAudio サポートが追加されました。実際的には後継バージョンである23H2から対応をアピールしています。

システムソフトウェアとしてのWindowsはLEAudioおよびLC3を標準サポートしましたが、それだけでなくBluetooth アダプターのドライバーパッケージにおけるソフトウェアオフロードでの対応か、Bluetooth アダプターのコントローラや専用オーディオDSPでの実装によるハードウェアオフロードが必要となります。

Intelが13世代Coreからの対応を謳ったことがあったためにCPUの世代に関係あるものと誤解しているかたを見ますが、Intelは無線モジュールのベンダーでもあり、これは13世代Coreと抱き合わせで（あるいはSoC内蔵で）販売されるIntel製WiFi/Bluetooth アダプターで出荷時からの対応を始める、という意味合いです。

13世代以降のCoreやCore Ultra搭載機種であってもグレードの低い製品はアダプターのBluetooth バージョンが古いものが混在しており、非対応の場合があります。ハードウェアレベルでは対応していても、デバイスベンダーによって無効化された状態で出荷されている場合もあります。

Intelと同じくWindows向けのCPUベンダであるAMDは単独でWiFi/Bluetooth アダプターの提供を行っていませんが、Mediatekと協業してMediaTek Filogicを投入しています。こちらはFilogic 380、Filogic 360などがLEAudio対応をアナウンスしています。

一部ゲームアプリの互換性に問題を抱えているものの、ARM SoCを提供するQualcommのチップセットはLEAudioおよびaptX AdaptiveやそのサブセットのaptX Lossless、aptX VoiceなどのSnapdragon Sound エコシステムに対応しています。

Windows 11のクラシックオーディオではWindows 10で非対応だったAACコーデックのサポートも追加されています。標準的な環境で利用可能なコーデックはクラシックオーディオでSBC/aptX/AACとなります。

ESUによるセキュリティサポートが2027年10月まで延長されることが決定した、Windows 10ではLEAudio サポートは行われていません。標準的な環境で利用可能なコーデックはクラシックオーディオのSBC/aptXのみ。

### Mac OS/iOS/iPad OS

いずれも現時点ではLEAudioに非対応で、LEAudio対応のオーディオトランスミッターなどを使用しない限り、利用はできません。

Bluetooth SIGによると、iPhone 14 ProやAppleWatch 8でLC3サポートが行われるという認証情報が公開されているほか、β版や解析ベースではiOS 16時点からLC3対応の痕跡が見受けられることが話題となっています。今後のソフトウェアか、製品そのもののアップデートによって利用が解禁されていくことになるかと思われます。

利用可能な標準コーデックはMacOSがSBC/aptX/AAC、iOSとiPadOSでSBC/AACとなります。

### Android

AOSPにおいては、Android 13にてLEAudioが標準サポートへ追加されました。

ただし、ハードウェアレベルではBluetooth 5.2以降をサポートし、同一のチップを搭載する機種ではLEAudio サポートが行われていてもOEMベンダーによって機能が無効化されていてLEAudioが利用出来ない場合があります。

確実にLEAudioを利用したい場合は端末ごとに対応状況の確認が必要です。対応機種は開発者オプションからLEAudio 優先接続モードへの切り替えスイッチを有効にすることも出来ます。また、Android 15から開発者向けオプションに許可リストを回避するスイッチが追加されています。

開発者向けオプションからハードウェアオフロードの無効化が出来る場合がありますが、ハードウェアオフロードを使用したほうがシステムのバッファが小さくなり、結果的に低遅延で利用できる場合がほとんどです。

ソフトウェアオフロードはメインCPUの使用率が高くなると、スタッタリングや顕著な音質低下が発生することもあり、何らかの不具合が発生する場合を除けば、出来る限りハードウェアオフロードを使用することが望ましいです。

利用までのハードルはやはり色々ありますが、対応端末は最も手ごろなプラットフォームです。SONY製端末などはイヤホン側のヘルプページで対応状況を公表されています。

また、Nexus時代と異なり、リファレンス端末と言い難いですがGoogle PixelおよびGoogle Pixel Buds Pro 2／Pixel Buds 2aでもLEAudioに対応します。ただし、2026年7月時点では、開発者向けオプションから上記の許可リスト回避スイッチを有効にした上で、再ペアリング作業をしないとLEAudioの利用はマスクされています。

Android 16から、Bluetooth LE Audioの音声伝送規格「Auracast」もサポートに追加されました。名前の「cast」が示すように、1つの送信デバイスから無制限の受信デバイスへ音声をキャスト（送信）できます。従来のBluetoothは1：1が原則で、事前にペアリング済みの受信デバイスに対して音声を送信することしか出来ませんでした。Auracastでは1：多接続が可能で、事前ペアリングも必要ありません。QRコードのスキャンでストリーミングに参加することも出来ます。Pixel スマートフォンでは9シリーズ以降で対応するようです。

ベンダーによってどのコーデックを実装するかが選択可能なので、必ずしも全てのコーデックが実装されるとは限りませんが、クラシックオーディオではSBC/aptX/AAC/LDAC、Qualcomm SoC搭載機種でaptX adaptive、Samsungの独自でScalable Codec、Huawei(とSavitech)が主導する中華端末で使用されるLHDC、オープンソースですが現状Google Pixelでのみ採用が見られるOpusが使用されます。

### Linux

Ubuntuなどで採用されているマルチメディアフレームワーク PipeWireでLC3を使用したオーディオストリーム[^1]のサポートが始まっています。ただし、[GitHub - google/liblc3](https://github.com/google/liblc3.git)よりLC3コーデックをビルドしてインストールする必要があり、多少の知識と手間が必要です。

もちろん、アイソクロナス転送とEATTをサポートする適切なBluetooth アダプターとそのドライバも必要となります。

実用段階に近づいてはいますが、ディストリビューションやハードウェア依存がとても大きく、自動で常に使える状況ではありませんし標準機能と呼べるものではありません。

### ChromeOS（Chromebook）／Googlebook

2024年6月に、Android スタックをベースに開発されるようになることがアナウンスされており、Android アプリが動作するほか、既にBluetooth スタックが統合されているもの、GoogleのPixel Buds シリーズ以外の他社製コンパニオンアプリは正式に対応せず、ほとんどはきちんと動きません。

Android 13以降の展開は始まっているものの、型落ちや超格安のチップが使用されるため、ハードウェア的な制限からLEAudioは利用できない状況がまだ続きそうです。クラシックオーディオ使用時のコーデックはSBC/AACのみ。

2026年にGoogleから正式発表されたGooglebook（AluminumOS）は完全にAndroid ベースで再構成されたフラッグシップカテゴリーのラップトップです。ハードウェア的な詳細については明らかになっていないところが多いですが、プレミアムなチップを搭載すること、ベースがAndroidのため当初からLEAudio／LC3も利用可能なのではないかと目されています。

### Bluetooth オーディオアダプター

デバイスを買い替えなくてもLEAudioやCDロスレスSnapdragonSoundにアップグレード出来るBluetooth トランスミッター（USB オーディオアダプター）として、

- [Creative BT-W6（Creative 直販限定）](https://jp.creative.com/p/speakers/creative-bt-w6)
- FIIO BT11（販売終了）
- Eppfun AK3040 Pro Max（おそらく販売終了？）

といった製品が発売したのですが、販売が打ち切られてしまった製品が多く入手性がよくありません。また、仕様がきちんと固まっていない状態での製品なので動作状況がまちまちで、製品の組み合わせによって使用コーデックやビットレートが自動的に選択され能動的にLEAudioが利用できない場合があります。

- JBL TOUR PRO 3
- AKG N5 HYBRID

のように、3.5mm AUX接続やUSB-Cの接続でバッテリーケースがトランスミッターになる製品、USB-Cのトランスミッターが同梱される製品も存在しますが、これらは高額になってしまいます。

参考／関連リンク

- [Bluetooth® Technology Website](https://www.bluetooth.com/)
- [Bluetooth Low Energy (LE) Audio - Windows drivers | Microsoft Learn](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-low-energy-audio)
- [BlueZ » Blog Archive » LE Audio support in PipeWire](https://www.bluez.org/le-audio-support-in-pipewire/)
- [Android 13 Compatibility Definition | Android Open Source Project](https://source.android.com/docs/compatibility/13/android-13-cdd#:~:text=If%20device%20implementations%20return%20true%20for%20the%20BluetoothAdapter.isLeAudioSupported()%20API%2C%20then%20they%3A)
- [LinkBuds S | ヘルプガイド | 使用可能時間](https://helpguide.sony.net/mdr/linkbudss/v1/ja/contents/TP1000536104.html)
- [GitHub - google/liblc3](https://github.com/google/liblc3.git)
- [Android’s Bluetooth stack, Fluoride, comes to ChromeOS | ChromeOS.dev](https://chromeos.dev/en/posts/androids-bluetooth-stack-fluoride-comes-to-chromeos)
- [オーラキャスト® 製品検索｜ブルートゥース® テクノロジーウェブサイト](https://www.bluetooth.com/ja-jp/auracast/find-a-product/)

[^1]: プロファイルはBasic Audio Profile (BAP)のみ。ハンズフリーやヘッドホンなどの上位プロファイルに非対応

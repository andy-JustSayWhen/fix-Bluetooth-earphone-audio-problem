import CoreAudio
import Foundation

struct AudioDeviceSnapshot: Codable, Equatable {
    let id: UInt32
    let name: String
    let uid: String
    let manufacturer: String
    let transport: String
    let nominalRateGlobal: Double
    let nominalRateInput: Double
    let nominalRateOutput: Double
    let inputChannels: Int
    let outputChannels: Int
    let availableRates: [String]
    let isRunning: Bool
    let isDefaultInput: Bool
    let isDefaultOutput: Bool
    let isDefaultSystemOutput: Bool
    let inferredMode: String
}

struct MonitorSnapshot: Codable, Equatable {
    let timestamp: String
    let elapsedSeconds: Double
    let defaultInputID: UInt32
    let defaultInputName: String
    let defaultOutputID: UInt32
    let defaultOutputName: String
    let defaultSystemOutputID: UInt32
    let defaultSystemOutputName: String
    let devices: [AudioDeviceSnapshot]
}

struct MonitorEvent: Codable {
    let timestamp: String
    let elapsedSeconds: Double
    let type: String
    let message: String
    let before: MonitorSnapshot?
    let after: MonitorSnapshot
}

let systemObject = AudioObjectID(kAudioObjectSystemObject)
let isoFormatter = ISO8601DateFormatter()

func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func readString(_ id: AudioObjectID, selector: AudioObjectPropertySelector) -> String {
    var propertyAddress = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let status = AudioObjectGetPropertyData(id, &propertyAddress, 0, nil, &size, &value)
    guard status == noErr, let value else { return "<status:\(status)>" }
    return value.takeUnretainedValue() as String
}

func readUInt32(_ id: AudioObjectID, selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32? {
    var propertyAddress = address(selector, scope: scope)
    var value = UInt32.zero
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(id, &propertyAddress, 0, nil, &size, &value) == noErr else { return nil }
    return value
}

func readBool(_ id: AudioObjectID, selector: AudioObjectPropertySelector) -> Bool {
    guard let value = readUInt32(id, selector: selector) else { return false }
    return value != 0
}

func readDouble(_ id: AudioObjectID, selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> Double {
    var propertyAddress = address(selector, scope: scope)
    var value = Double.zero
    var size = UInt32(MemoryLayout<Double>.size)
    let status = AudioObjectGetPropertyData(id, &propertyAddress, 0, nil, &size, &value)
    return status == noErr ? value : -1
}

func readChannels(_ id: AudioObjectID, scope: AudioObjectPropertyScope) -> Int {
    var propertyAddress = address(kAudioDevicePropertyStreamConfiguration, scope: scope)
    var size = UInt32.zero
    guard AudioObjectGetPropertyDataSize(id, &propertyAddress, 0, nil, &size) == noErr, size > 0 else { return -1 }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &propertyAddress, 0, nil, &size, raw) == noErr else { return -1 }
    let list = UnsafeMutableAudioBufferListPointer(raw.bindMemory(to: AudioBufferList.self, capacity: 1))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func readAvailableRates(_ id: AudioObjectID) -> [String] {
    var propertyAddress = address(kAudioDevicePropertyAvailableNominalSampleRates)
    var size = UInt32.zero
    guard AudioObjectGetPropertyDataSize(id, &propertyAddress, 0, nil, &size) == noErr, size > 0 else { return [] }
    let count = Int(size) / MemoryLayout<AudioValueRange>.size
    var ranges = Array(repeating: AudioValueRange(mMinimum: 0, mMaximum: 0), count: count)
    guard AudioObjectGetPropertyData(id, &propertyAddress, 0, nil, &size, &ranges) == noErr else { return [] }
    return ranges.map { range in
        if abs(range.mMinimum - range.mMaximum) < 0.5 {
            return String(format: "%.0f", range.mMinimum)
        }
        return String(format: "%.0f-%.0f", range.mMinimum, range.mMaximum)
    }
}

func deviceIDs() -> [AudioDeviceID] {
    var propertyAddress = address(kAudioHardwarePropertyDevices)
    var size = UInt32.zero
    guard AudioObjectGetPropertyDataSize(systemObject, &propertyAddress, 0, nil, &size) == noErr else { return [] }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = Array(repeating: AudioDeviceID(0), count: count)
    guard AudioObjectGetPropertyData(systemObject, &propertyAddress, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioDeviceID {
    var propertyAddress = address(selector)
    var id = AudioDeviceID.zero
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    _ = AudioObjectGetPropertyData(systemObject, &propertyAddress, 0, nil, &size, &id)
    return id
}

func transportName(_ value: UInt32?) -> String {
    guard let value else { return "未知" }
    switch value {
    case kAudioDeviceTransportTypeBluetooth: return "蓝牙"
    case kAudioDeviceTransportTypeUSB: return "USB"
    case kAudioDeviceTransportTypeBuiltIn: return "内置"
    case kAudioDeviceTransportTypeDisplayPort: return "DisplayPort"
    case kAudioDeviceTransportTypeAggregate: return "聚合设备"
    case kAudioDeviceTransportTypeVirtual: return "虚拟设备"
    default: return String(format: "未知(0x%08X)", value)
    }
}

func inferredMode(rate: Double, outputChannels: Int, inputChannels: Int, transport: String) -> String {
    guard transport == "蓝牙" else { return "非蓝牙设备" }
    if outputChannels == 1 && inputChannels > 0 && rate > 0 && rate <= 16000 {
        return "疑似蓝牙通话模式（HFP/HSP，设备指标推断）"
    }
    if outputChannels >= 2 && rate >= 44100 {
        return "疑似蓝牙立体声播放模式（A2DP，设备指标推断）"
    }
    if inputChannels > 0 && outputChannels == 0 {
        return "蓝牙输入端点"
    }
    return "蓝牙模式未能仅凭设备指标判断"
}

func deviceName(_ id: AudioDeviceID) -> String {
    guard id != 0 else { return "无设备" }
    return "\(readString(id, selector: kAudioObjectPropertyName)) [id=\(id)]"
}

func makeSnapshot(started: Date) -> MonitorSnapshot {
    let inputID = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
    let outputID = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
    let systemOutputID = defaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice)
    let devices = deviceIDs().map { id -> AudioDeviceSnapshot in
        let name = readString(id, selector: kAudioObjectPropertyName)
        let uid = readString(id, selector: kAudioDevicePropertyDeviceUID)
        let manufacturer = readString(id, selector: kAudioObjectPropertyManufacturer)
        let transport = transportName(readUInt32(id, selector: kAudioDevicePropertyTransportType))
        let outputRate = readDouble(id, selector: kAudioDevicePropertyNominalSampleRate, scope: kAudioObjectPropertyScopeOutput)
        let inputRate = readDouble(id, selector: kAudioDevicePropertyNominalSampleRate, scope: kAudioObjectPropertyScopeInput)
        let globalRate = readDouble(id, selector: kAudioDevicePropertyNominalSampleRate)
        let inputChannels = readChannels(id, scope: kAudioObjectPropertyScopeInput)
        let outputChannels = readChannels(id, scope: kAudioObjectPropertyScopeOutput)
        let effectiveRate = outputChannels > 0 ? outputRate : inputRate
        return AudioDeviceSnapshot(
            id: id,
            name: name,
            uid: uid,
            manufacturer: manufacturer,
            transport: transport,
            nominalRateGlobal: globalRate,
            nominalRateInput: inputRate,
            nominalRateOutput: outputRate,
            inputChannels: inputChannels,
            outputChannels: outputChannels,
            availableRates: readAvailableRates(id),
            isRunning: readBool(id, selector: kAudioDevicePropertyDeviceIsRunning),
            isDefaultInput: id == inputID,
            isDefaultOutput: id == outputID,
            isDefaultSystemOutput: id == systemOutputID,
            inferredMode: inferredMode(rate: effectiveRate, outputChannels: outputChannels, inputChannels: inputChannels, transport: transport)
        )
    }
    return MonitorSnapshot(
        timestamp: isoFormatter.string(from: Date()),
        elapsedSeconds: Date().timeIntervalSince(started),
        defaultInputID: inputID,
        defaultInputName: deviceName(inputID),
        defaultOutputID: outputID,
        defaultOutputName: deviceName(outputID),
        defaultSystemOutputID: systemOutputID,
        defaultSystemOutputName: deviceName(systemOutputID),
        devices: devices
    )
}

func jsonLine<T: Encodable>(_ value: T) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(value), let line = String(data: data, encoding: .utf8) else { return "{\"encoding_error\":true}" }
    return line
}

func appendLine(_ line: String, to handle: FileHandle) {
    if let data = (line + "\n").data(using: .utf8) {
        handle.write(data)
    }
}

func printForeground(_ line: String) {
    print(line)
    fflush(stdout)
}

func modeSummary(_ snapshot: MonitorSnapshot) -> String {
    let selectedNames = Set(snapshot.devices.filter {
        $0.isDefaultInput || $0.isDefaultOutput || $0.name.localizedCaseInsensitiveContains("Bose")
    }.map { $0.name })
    return selectedNames.sorted().compactMap { name in
        let named = snapshot.devices.filter { $0.name == name }
        guard let output = named.first(where: { $0.isDefaultOutput && $0.outputChannels > 0 }) ?? named.first(where: { $0.outputChannels > 0 }) else { return nil }
        let input = named.first(where: { $0.isDefaultInput && $0.inputChannels > 0 })
        let inputRate = input?.nominalRateInput ?? -1
        let inputChannels = input?.inputChannels ?? 0
        let mode: String
        if output.transport == "蓝牙" && input != nil && output.outputChannels == 1 && output.nominalRateOutput > 0 && output.nominalRateOutput <= 16000 {
            mode = "疑似蓝牙通话模式（HFP/HSP，设备指标推断）"
        } else if output.transport == "蓝牙" && output.outputChannels >= 2 && output.nominalRateOutput >= 44100 {
            mode = "疑似蓝牙立体声播放模式（A2DP，设备指标推断）"
        } else if input != nil {
            mode = "输入输出均为同一蓝牙设备，但模式未能仅凭设备指标判断"
        } else {
            mode = output.inferredMode
        }
        return "\(name):输出\(output.nominalRateOutput)Hz/\(output.outputChannels)声道 输入\(inputRate)Hz/\(inputChannels)声道 \(mode)"
    }.joined(separator: "；")
}

func sameState(_ lhs: MonitorSnapshot, _ rhs: MonitorSnapshot) -> Bool {
    lhs.defaultInputID == rhs.defaultInputID &&
    lhs.defaultOutputID == rhs.defaultOutputID &&
    lhs.defaultSystemOutputID == rhs.defaultSystemOutputID &&
    lhs.devices == rhs.devices
}

let arguments = CommandLine.arguments
var duration = 600.0
var interval = 0.25
var outputDirectory = ""
var index = 1
while index < arguments.count {
    switch arguments[index] {
    case "--duration":
        index += 1
        if index < arguments.count { duration = Double(arguments[index]) ?? duration }
    case "--interval":
        index += 1
        if index < arguments.count { interval = max(0.05, Double(arguments[index]) ?? interval) }
    case "--output-dir":
        index += 1
        if index < arguments.count { outputDirectory = arguments[index] }
    case "--help":
        print("用法：macos-audio-route-monitor [--duration 秒] [--interval 秒] [--output-dir 目录]")
        exit(0)
    default:
        break
    }
    index += 1
}

let started = Date()
if outputDirectory.isEmpty {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyyMMdd-HHmmss"
    outputDirectory = "artifacts/audio-monitor/run-\(formatter.string(from: started))"
}
let outputURL = URL(fileURLWithPath: outputDirectory, isDirectory: true)
try? FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
let samplesURL = outputURL.appendingPathComponent("samples.jsonl")
let eventsURL = outputURL.appendingPathComponent("events.jsonl")
FileManager.default.createFile(atPath: samplesURL.path, contents: nil)
FileManager.default.createFile(atPath: eventsURL.path, contents: nil)
let samplesHandle = try! FileHandle(forWritingTo: samplesURL)
let eventsHandle = try! FileHandle(forWritingTo: eventsURL)
defer {
    try? samplesHandle.close()
    try? eventsHandle.close()
}

printForeground("音频监视已启动：\(isoFormatter.string(from: started))")
printForeground("详细快照：\(samplesURL.path)")
printForeground("事件记录：\(eventsURL.path)")
printForeground("前台关键节点会在默认路由、采样率、声道或推断模式变化时显示。")

var previous: MonitorSnapshot?
var lastHeartbeat = Date.distantPast
while Date().timeIntervalSince(started) < duration {
    let current = makeSnapshot(started: started)
    appendLine(jsonLine(current), to: samplesHandle)

    if previous == nil {
        let event = MonitorEvent(timestamp: current.timestamp, elapsedSeconds: current.elapsedSeconds, type: "started", message: "初始状态：\(current.defaultInputName)；输出：\(current.defaultOutputName)；\(modeSummary(current))", before: nil, after: current)
        appendLine(jsonLine(event), to: eventsHandle)
        printForeground("[关键节点 0s] 初始输入=\(current.defaultInputName)；输出=\(current.defaultOutputName)")
        printForeground("[设备指标] \(modeSummary(current))")
    } else if !sameState(current, previous!) {
        var changes: [String] = []
        if current.defaultInputID != previous!.defaultInputID { changes.append("默认输入：\(previous!.defaultInputName) -> \(current.defaultInputName)") }
        if current.defaultOutputID != previous!.defaultOutputID { changes.append("默认输出：\(previous!.defaultOutputName) -> \(current.defaultOutputName)") }
        if current.defaultSystemOutputID != previous!.defaultSystemOutputID { changes.append("系统提示音输出：\(previous!.defaultSystemOutputName) -> \(current.defaultSystemOutputName)") }
        let oldByUID = Dictionary(uniqueKeysWithValues: previous!.devices.map { ($0.uid, $0) })
        for device in current.devices {
            guard let old = oldByUID[device.uid] else { changes.append("设备出现：\(device.name)"); continue }
            if old.nominalRateOutput != device.nominalRateOutput || old.outputChannels != device.outputChannels || old.inferredMode != device.inferredMode {
                changes.append("\(device.name) 输出：\(old.nominalRateOutput)Hz/\(old.outputChannels)声道/\(old.inferredMode) -> \(device.nominalRateOutput)Hz/\(device.outputChannels)声道/\(device.inferredMode)")
            }
            if old.nominalRateInput != device.nominalRateInput || old.inputChannels != device.inputChannels {
                changes.append("\(device.name) 输入：\(old.nominalRateInput)Hz/\(old.inputChannels)声道 -> \(device.nominalRateInput)Hz/\(device.inputChannels)声道")
            }
            if old.isRunning != device.isRunning { changes.append("\(device.name) 运行状态：\(old.isRunning) -> \(device.isRunning)") }
        }
        let message = changes.isEmpty ? "设备快照发生变化" : changes.joined(separator: "；")
        let event = MonitorEvent(timestamp: current.timestamp, elapsedSeconds: current.elapsedSeconds, type: "state_changed", message: message, before: previous, after: current)
        appendLine(jsonLine(event), to: eventsHandle)
        printForeground("[关键节点 \(String(format: "%.1f", current.elapsedSeconds))s] \(message)")
        printForeground("[设备指标] \(modeSummary(current))")
    } else if Date().timeIntervalSince(lastHeartbeat) >= 5 {
        printForeground("[心跳 \(String(format: "%.0f", current.elapsedSeconds))s] 输入=\(current.defaultInputName)；输出=\(current.defaultOutputName)；\(modeSummary(current))")
        lastHeartbeat = Date()
    }
    previous = current
    Thread.sleep(forTimeInterval: interval)
}

let finished = makeSnapshot(started: started)
appendLine(jsonLine(finished), to: samplesHandle)
let finishEvent = MonitorEvent(timestamp: finished.timestamp, elapsedSeconds: finished.elapsedSeconds, type: "finished", message: "监视结束", before: previous, after: finished)
appendLine(jsonLine(finishEvent), to: eventsHandle)
printForeground("音频监视已结束：\(finished.timestamp)")
printForeground("完整记录目录：\(outputURL.path)")

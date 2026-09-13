// Windows audio endpoint probe core, shared by full probe and realtime watch.
// Compiled at runtime via PowerShell Add-Type; must stay C# 5 compatible and ASCII only.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
public enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
}

[ComImport, Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDeviceTopology {
    [PreserveSig] int GetConnectorCount(out uint count);
    [PreserveSig] int GetConnector(uint index, out IConnector connector);
}
[ComImport, Guid("9c2c4058-23f5-41de-877a-df3af236a09e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IConnector {
    [PreserveSig] int GetType(out int type);
    [PreserveSig] int GetDataFlow(out int flow);
    [PreserveSig] int ConnectTo(IConnector other);
    [PreserveSig] int Disconnect();
    [PreserveSig] int IsConnected([MarshalAs(UnmanagedType.Bool)] out bool connected);
    [PreserveSig] int GetConnectedTo(out IConnector other);
    [PreserveSig] int GetConnectorIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetDeviceIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[StructLayout(LayoutKind.Sequential)]
public struct KSNODEPROPERTY { public Guid Set; public uint Id; public uint Flags; public uint Node; public uint Reserved; }
[ComImport, Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IKsControl {
    [PreserveSig] int KsProperty(ref KSNODEPROPERTY property, uint propertyLength, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 3)] byte[] data, uint dataLength, out uint bytesReturned);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(uint stgmAccess, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int Commit();
}

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

[StructLayout(LayoutKind.Sequential)]
public struct PROPVARIANTBLOB { public uint size; public IntPtr data; }

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
    [FieldOffset(8)] public Int64 int64Value;
    [FieldOffset(8)] public Int32 int32Value;
    [FieldOffset(8)] public UInt32 uint32Value;
    [FieldOffset(8)] public PROPVARIANTBLOB blob;
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint bufferFrames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
    [PreserveSig] int GetMixFormat(out IntPtr format);
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
public struct WAVEFORMATEX {
    public ushort formatTag;
    public ushort channels;
    public uint sampleRate;
    public uint avgBytesPerSec;
    public ushort blockAlign;
    public ushort bitsPerSample;
    public ushort extraSize;
}

public class AudioEndpoint {
    public string Flow;
    public string Id;
    public string Name;
    public uint Rate;
    public uint Channels;
    public uint Bits;
    public string Sessions = "[]";
    public bool SessionsKnown;
    public uint ConfiguredRate;
    public uint ConfiguredChannels;
    public string ConfiguredStatus = "unavailable";
    public string SupportedRates = "[]";
    public string SupportedStatus = "unavailable";
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 control);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr context);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(ref Guid grouping, IntPtr context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
}

public static class WindowsAudioProbeCore {
    // Win64 EVENT_TRACE_LOGFILEW layout from the Windows SDK. Pointer size is checked.
    [StructLayout(LayoutKind.Explicit, Size = 448)]
    private struct TraceLog {
        [FieldOffset(0)] public IntPtr FileName;
        [FieldOffset(8)] public IntPtr LoggerName;
        [FieldOffset(28)] public uint Mode;
        [FieldOffset(400)] public IntPtr BufferCallback;
        [FieldOffset(424)] public IntPtr EventCallback;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyDescriptor {public ulong Name; public uint ArrayIndex; public uint Reserved;}
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void TraceCallback(IntPtr record);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate uint BufferCallback(IntPtr log);
    [DllImport("advapi32.dll", EntryPoint = "OpenTraceW", SetLastError = true)] private static extern ulong OpenTrace(ref TraceLog log);
    [DllImport("advapi32.dll")] private static extern uint ProcessTrace(ulong[] handles, uint count, IntPtr start, IntPtr end);
    [DllImport("advapi32.dll")] private static extern uint CloseTrace(ulong handle);
    [DllImport("tdh.dll")] private static extern uint TdhGetPropertySize(IntPtr record, uint contextCount, IntPtr context, uint count, ref PropertyDescriptor descriptor, out uint size);
    [DllImport("tdh.dll")] private static extern uint TdhGetProperty(IntPtr record, uint contextCount, IntPtr context, uint count, ref PropertyDescriptor descriptor, uint size, [Out] byte[] value);
    private class VoiceLink {public string Address; public string Timestamp;}
    private static readonly object linkLock = new object();
    private static readonly Dictionary<int, VoiceLink> voiceLinks = new Dictionary<int, VoiceLink>();
    private static readonly TraceCallback traceCallback = OnTraceEvent;
    private static readonly BufferCallback bufferCallback = OnTraceBuffer;
    private static volatile bool traceHealthy;
    private static ulong traceHandle = UInt64.MaxValue;
    private static byte[] TraceProperty(IntPtr record, string name) {
        IntPtr pointer = Marshal.StringToHGlobalUni(name);
        try {
            PropertyDescriptor descriptor = new PropertyDescriptor {Name = unchecked((ulong)pointer.ToInt64()), ArrayIndex = UInt32.MaxValue};
            uint size;
            if (TdhGetPropertySize(record, 0, IntPtr.Zero, 1, ref descriptor, out size) != 0 || size > 65536) return null;
            byte[] data = new byte[size];
            return TdhGetProperty(record, 0, IntPtr.Zero, 1, ref descriptor, size, data) == 0 ? data : null;
        } finally {Marshal.FreeHGlobal(pointer);}
    }
    private static uint OnTraceBuffer(IntPtr log) {
        // TRACE_LOGFILE_HEADER.EventsLost and BuffersLost in the Win64 layout.
        if (Marshal.ReadInt32(log, 168) != 0 || Marshal.ReadInt32(log, 396) != 0) {
            lock (linkLock) {voiceLinks.Clear(); traceHealthy = false;}
        }
        return 1;
    }
    private static void OnTraceEvent(IntPtr record) {
        try {
            Guid provider = (Guid)Marshal.PtrToStructure(IntPtr.Add(record, 24), typeof(Guid));
            if (provider != new Guid("8A1F9517-3A8C-4A9E-A018-4F17A200F277") || Marshal.ReadInt16(record, 40) != 402) return;
            byte[] type = TraceProperty(record, "BIP_Type");
            byte[] packet = TraceProperty(record, "BIP_Data");
            if (type == null || type.Length == 0 || type[0] != 2 || packet == null) return;
            ObserveControllerEvent(packet, DateTime.FromFileTimeUtc(Marshal.ReadInt64(record, 16)).ToString("o"));
        } catch {lock (linkLock) {voiceLinks.Clear(); traceHealthy = false;}}
    }
    public static void ObserveControllerEvent(byte[] packet, string timestamp) {
        if (packet.Length < 2 || packet.Length != packet[1] + 2) return;
        lock (linkLock) {
            if (packet[0] == 0x2C && packet.Length == 19 && packet[2] == 0 && (packet[11] == 0 || packet[11] == 2)) {
                int handle = BitConverter.ToUInt16(packet, 3) & 0xFFF;
                byte[] address = new byte[6]; Array.Copy(packet, 5, address, 0, 6); Array.Reverse(address);
                string text = BitConverter.ToString(address).Replace("-", "");
                if (text != "000000000000") voiceLinks[handle] = new VoiceLink {Address = text, Timestamp = timestamp};
            } else if (packet[0] == 0x05 && packet.Length == 6 && packet[2] == 0) {
                voiceLinks.Remove(BitConverter.ToUInt16(packet, 3) & 0xFFF);
            }
        }
    }
    private static ulong OpenLinkTrace(string name, bool realtime) {
        if (IntPtr.Size != 8) throw new PlatformNotSupportedException("Bluetooth trace requires a 64-bit process");
        IntPtr pointer = Marshal.StringToHGlobalUni(name);
        try {
            TraceLog log = new TraceLog {Mode = 0x10000000u | (realtime ? 0x100u : 0u), EventCallback = Marshal.GetFunctionPointerForDelegate(traceCallback), BufferCallback = Marshal.GetFunctionPointerForDelegate(bufferCallback)};
            if (realtime) log.LoggerName = pointer; else log.FileName = pointer;
            ulong handle = OpenTrace(ref log);
            if (handle == UInt64.MaxValue) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return handle;
        } finally {Marshal.FreeHGlobal(pointer);}
    }
    public static void StartLinkTrace(string name) {
        lock (linkLock) {voiceLinks.Clear(); traceHealthy = true;}
        try {traceHandle = OpenLinkTrace(name, true);} catch {traceHealthy = false; throw;}
        var thread = new System.Threading.Thread(delegate() {
            try {ProcessTrace(new ulong[] {traceHandle}, 1, IntPtr.Zero, IntPtr.Zero);}
            finally {lock (linkLock) {voiceLinks.Clear(); traceHealthy = false;}}
        });
        thread.IsBackground = true; thread.Start();
    }
    public static void StopLinkTrace() {
        if (traceHandle != UInt64.MaxValue) {CloseTrace(traceHandle); traceHandle = UInt64.MaxValue;}
        lock (linkLock) {voiceLinks.Clear(); traceHealthy = false;}
    }
    public static string InspectTraceFile(string path) {
        lock (linkLock) {voiceLinks.Clear(); traceHealthy = true;}
        ulong handle = OpenLinkTrace(path, false);
        try {ProcessTrace(new ulong[] {handle}, 1, IntPtr.Zero, IntPtr.Zero); return VoiceLinksJson();}
        finally {CloseTrace(handle); lock (linkLock) {voiceLinks.Clear(); traceHealthy = false;}}
    }
    public static string InspectControllerEvents(string[] packets) {
        if (traceHandle != UInt64.MaxValue) throw new InvalidOperationException("A live trace is active");
        lock (linkLock) {
            voiceLinks.Clear(); traceHealthy = true;
            try {
                foreach (string hex in packets) {
                    if (hex.Length % 2 != 0) continue;
                    byte[] packet = new byte[hex.Length / 2];
                    for (int i = 0; i < packet.Length; i++) packet[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
                    ObserveControllerEvent(packet, "2026-01-01T00:00:00Z");
                }
                return VoiceLinksJson();
            } finally {voiceLinks.Clear(); traceHealthy = false;}
        }
    }
    private static string VoiceLinksJson() {
        lock (linkLock) {
            List<string> values = new List<string>();
            if (traceHealthy) foreach (VoiceLink link in voiceLinks.Values) values.Add("{\"address\":" + Escape(link.Address) + ",\"timestamp\":" + Escape(link.Timestamp) + "}");
            return "[" + String.Join(",", values.ToArray()) + "]";
        }
    }
    // Read-only diagnostic: hardware engine format is not automatically a radio clock.
    public static string InspectHardwareFormats() {
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        List<string> records = new List<string>();
        try {
            foreach (EDataFlow flow in new EDataFlow[] {EDataFlow.eRender, EDataFlow.eCapture}) {
                IMMDevice endpoint;
                if (enumerator.GetDefaultAudioEndpoint(flow, ERole.eConsole, out endpoint) != 0) continue;
                try {
                    InspectKernelProperties(endpoint, flow + ":endpoint", records);
                    Guid topologyId = typeof(IDeviceTopology).GUID; object topologyObject;
                    int hr = endpoint.Activate(ref topologyId, 23, IntPtr.Zero, out topologyObject);
                    if (hr != 0) { records.Add(Escape(flow + ":topology:" + hr.ToString("X8"))); continue; }
                    IDeviceTopology topology = (IDeviceTopology)topologyObject;
                    try {
                        uint count; if (topology.GetConnectorCount(out count) != 0 || count > 64) continue;
                        for (uint i = 0; i < count; i++) {
                            IConnector connector;
                            if (topology.GetConnector(i, out connector) != 0) continue;
                            try {
                                string id; if (connector.GetDeviceIdConnectedTo(out id) != 0) continue;
                                IMMDevice hardware; if (enumerator.GetDevice(id, out hardware) != 0) continue;
                                try {
                                    InspectKernelProperties(hardware, flow + ":adapter", records);
                                } finally {Marshal.ReleaseComObject(hardware);}
                            } finally {Marshal.ReleaseComObject(connector);}
                        }
                    } finally {Marshal.ReleaseComObject(topology);}
                } finally {Marshal.ReleaseComObject(endpoint);}
            }
        } finally {Marshal.ReleaseComObject(enumerator);}
        return "[" + String.Join(",", records.ToArray()) + "]";
    }
    private static void InspectKernelProperties(IMMDevice device, string label, List<string> records) {
        Guid controlId = typeof(IKsControl).GUID; object value;
        int hr = device.Activate(ref controlId, 23, IntPtr.Zero, out value);
        records.Add(Escape(label + ":activate:" + hr.ToString("X8")));
        if (hr != 0) return;
        IKsControl control = (IKsControl)value;
        try {InspectProperties(control.KsProperty, label, records);} finally {Marshal.ReleaseComObject(control);}
    }
    private delegate int PropertyReader(ref KSNODEPROPERTY property, uint propertyLength, byte[] data, uint dataLength, out uint returned);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(Microsoft.Win32.SafeHandles.SafeFileHandle handle, uint code, ref KSNODEPROPERTY input, uint inputLength, [Out] byte[] output, uint outputLength, out uint returned, IntPtr overlapped);
    public static string InspectFilterPath(string path) {
        List<string> records = new List<string>();
        using (var handle = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (handle.IsInvalid) return "[" + Escape("filter:open:error-" + Marshal.GetLastWin32Error()) + "]";
            PropertyReader reader = delegate(ref KSNODEPROPERTY prop, uint size, byte[] data, uint length, out uint returned) {
                if (DeviceIoControl(handle, 0x002F0003, ref prop, size, data, length, out returned, IntPtr.Zero)) return 0;
                return unchecked((int)(0x80070000u | (uint)Marshal.GetLastWin32Error()));
            };
            InspectProperties(reader, "filter", records);
        }
        return "[" + String.Join(",", records.ToArray()) + "]";
    }
    private static void InspectProperties(PropertyReader query, string label, List<string> records) {
        int hr;
            byte[] data = new byte[65536]; uint returned;
            Guid pinSet = new Guid("8C134960-51AD-11CF-878A-94F801C10000");
            KSNODEPROPERTY prop = new KSNODEPROPERTY {Set = pinSet, Id = 1, Flags = 1};
            hr = query(ref prop, 24, data, (uint)data.Length, out returned);
            records.Add(Escape(label + ":pin-count-query:" + hr.ToString("X8")));
            if (hr == 0 && returned >= 4) {
                uint pins = BitConverter.ToUInt32(data, 0);
                records.Add(Escape(label + ":pin-count:" + pins));
                if (pins <= 128) for (uint pin = 0; pin < pins; pin++) {
                    prop = new KSNODEPROPERTY {Set = pinSet, Id = 10, Flags = 1, Node = pin};
                    hr = query(ref prop, 32, data, (uint)data.Length, out returned);
                    records.Add(Escape(label + ":pin:" + pin + ":physical:" + (hr == 0 && returned > 8 ? Encoding.Unicode.GetString(data, 8, (int)returned - 8).TrimEnd('\0') : "error-" + hr.ToString("X8"))));
                    prop = new KSNODEPROPERTY {Set = pinSet, Id = 8, Flags = 1, Node = pin};
                    hr = query(ref prop, 32, data, (uint)data.Length, out returned);
                    records.Add(Escape(label + ":pin:" + pin + ":global-instances:" + (hr == 0 && returned >= 8 ? BitConverter.ToUInt32(data, 4).ToString() : "error-" + hr.ToString("X8"))));
                }
            }
            prop = new KSNODEPROPERTY {Set = new Guid("720D4AC0-7533-11D0-A5D6-28DB04C10000"), Id = 1, Flags = 1};
            hr = query(ref prop, 24, data, (uint)data.Length, out returned);
            if (hr != 0 || returned < 8) {records.Add(Escape(label + ":nodes:" + hr.ToString("X8"))); return;}
            uint nodes = BitConverter.ToUInt32(data, 4);
            if (nodes > 128 || returned < 8 + nodes * 16) return;
            byte[] types = (byte[])data.Clone();
            for (uint node = 0; node < nodes; node++) {
                byte[] type = new byte[16]; Array.Copy(types, 8 + node * 16, type, 0, 16);
                records.Add(Escape(label + ":node:" + node + ":type:" + new Guid(type)));
                foreach (bool engine in new bool[] {true, false}) {
                    prop = new KSNODEPROPERTY {Set = new Guid(engine ? "3A2F82DC-886F-4BAA-9EB4-082B9025C536" : "45FFAAA0-6E1B-11D0-BCF2-444553540000"), Id = engine ? 4u : 8u, Flags = 0x10000200, Node = node};
                    hr = query(ref prop, 32, data, 4, out returned);
                    string name = engine ? "engine-format" : "sampling-rate";
                    records.Add(Escape(label + ":node:" + node + ":" + name + ":support:" + (hr == 0 && returned >= 4 ? BitConverter.ToUInt32(data, 0).ToString("X8") : "error-" + hr.ToString("X8"))));
                    prop.Flags = 0x10000001;
                    hr = query(ref prop, 32, data, (uint)data.Length, out returned);
                    uint minimum = engine ? 82u : 4u;
                    records.Add(Escape(label + ":node:" + node + ":" + name + ":read:" + (hr == 0 && returned >= minimum ? BitConverter.ToUInt32(data, engine ? 68 : 0).ToString() : "error-" + hr.ToString("X8"))));
                }
            }
    }
    private class FormatCache {
        public string Signature;
        public DateTime CheckedAt;
        public string Rates;
        public string Status;
    }
    private static readonly Dictionary<string, FormatCache> formatCache = new Dictionary<string, FormatCache>();

    private static void ReadConfiguredFormat(IPropertyStore store, AudioEndpoint endpoint) {
        PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("f19f064d-082c-4e27-bc73-6882a1bb8e4c"), pid = 0 };
        PROPVARIANT pv = new PROPVARIANT();
        try {
            int hr = store.GetValue(ref key, out pv);
            if (hr != 0) { endpoint.ConfiguredStatus = "error:" + hr.ToString("X8"); return; }
            if (pv.vt != 65 || pv.blob.data == IntPtr.Zero || pv.blob.size < 18) return;
            WAVEFORMATEX format = (WAVEFORMATEX)Marshal.PtrToStructure(pv.blob.data, typeof(WAVEFORMATEX));
            if (format.sampleRate == 0 || format.channels == 0 || pv.blob.size < 18 + format.extraSize) return;
            endpoint.ConfiguredRate = format.sampleRate;
            endpoint.ConfiguredChannels = format.channels;
            endpoint.ConfiguredStatus = "ok";
        } finally { PropVariantClear(ref pv); }
    }

    private static void ReadSupportedFormats(IAudioClient client, AudioEndpoint endpoint) {
        string signature = endpoint.ConfiguredRate + ":" + endpoint.ConfiguredChannels + ":" + endpoint.Rate + ":" + endpoint.Channels + ":" + endpoint.Bits;
        FormatCache cached;
        if (formatCache.TryGetValue(endpoint.Id, out cached) && cached.Signature == signature && (DateTime.UtcNow - cached.CheckedAt).TotalSeconds < 30) {
            endpoint.SupportedRates = cached.Rates; endpoint.SupportedStatus = cached.Status; return;
        }
        uint channels = endpoint.ConfiguredChannels > 0 ? endpoint.ConfiguredChannels : endpoint.Channels;
        if (channels == 0 || channels > 8) return;
        SortedSet<uint> rates = new SortedSet<uint>(new uint[] {8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000});
        if (endpoint.ConfiguredRate > 0) rates.Add(endpoint.ConfiguredRate);
        if (endpoint.Rate > 0) rates.Add(endpoint.Rate);
        List<string> supported = new List<string>();
        bool error = false;
        IntPtr buffer = Marshal.AllocCoTaskMem(40);
        try {
            foreach (uint rate in rates) {
                bool accepted = false;
                foreach (ushort bits in new ushort[] {16, 24, 32}) {
                    for (int variant = 0; variant < 4; variant++) {
                        bool floating = variant >= 2;
                        if (floating && bits != 32) continue;
                        bool extended = variant % 2 == 1;
                        ushort align = (ushort)(channels * bits / 8);
                        WAVEFORMATEX format = new WAVEFORMATEX {
                            formatTag = extended ? (ushort)65534 : floating ? (ushort)3 : (ushort)1,
                            channels = (ushort)channels, sampleRate = rate, bitsPerSample = bits,
                            blockAlign = align, avgBytesPerSec = rate * align, extraSize = extended ? (ushort)22 : (ushort)0
                        };
                        Marshal.StructureToPtr(format, buffer, false);
                        if (extended) {
                            Marshal.WriteInt16(buffer, 18, (short)bits);
                            Marshal.WriteInt32(buffer, 20, channels == 1 ? 4 : channels == 2 ? 3 : 0);
                            byte[] subFormat = new Guid(floating ? "00000003-0000-0010-8000-00aa00389b71" : "00000001-0000-0010-8000-00aa00389b71").ToByteArray();
                            Marshal.Copy(subFormat, 0, IntPtr.Add(buffer, 24), 16);
                        }
                        IntPtr closest;
                        int hr = client.IsFormatSupported(1, buffer, out closest);
                        if (closest != IntPtr.Zero) Marshal.FreeCoTaskMem(closest);
                        if (hr == 0) { accepted = true; break; }
                        if (hr != unchecked((int)0x88890008)) error = true;
                    }
                    if (accepted) break;
                }
                if (accepted) supported.Add(rate.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
        } finally { Marshal.FreeCoTaskMem(buffer); }
        endpoint.SupportedRates = "[" + String.Join(",", supported.ToArray()) + "]";
        endpoint.SupportedStatus = error ? "partial" : "ok";
        formatCache[endpoint.Id] = new FormatCache {Signature = signature, CheckedAt = DateTime.UtcNow, Rates = endpoint.SupportedRates, Status = endpoint.SupportedStatus};
    }
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Locate_DevNodeW(out uint node, string id, uint flags);
    [DllImport("cfgmgr32.dll")]
    private static extern uint CM_Get_Parent(out uint parent, uint node, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_IDW(uint node, StringBuilder id, int length, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_DevNode_PropertyW(uint node, ref PROPERTYKEY key, out uint type, byte[] buffer, ref uint size, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_ID_List_SizeW(out uint length, string filter, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_ID_ListW(string filter, char[] buffer, uint length, uint flags);

    private static string ContainerId(uint node) {
        PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("8c7ed206-3f8a-4827-b3ab-ae9e1faefc6c"), pid = 2 };
        byte[] bytes = new byte[16]; uint size = 16, type;
        if (CM_Get_DevNode_PropertyW(node, ref key, out type, bytes, ref size, 0) != 0 || type != 13 || size != 16) return null;
        string value = new Guid(bytes).ToString("D").ToUpperInvariant();
        return value == "00000000-0000-0000-0000-000000000000" || value == "00000000-0000-0000-FFFF-FFFFFFFFFFFF" ? null : value;
    }

    private static string FindBluetoothPhysicalNode(string container) {
        if (container == null) return null;
        uint size;
        if (CM_Get_Device_ID_List_SizeW(out size, "BTHENUM", 1) != 0 || size > 1048576) return null;
        char[] buffer = new char[size];
        if (CM_Get_Device_ID_ListW("BTHENUM", buffer, size, 1) != 0) return null;
        string result = null;
        foreach (string candidate in new string(buffer).Split('\0')) {
            if (!System.Text.RegularExpressions.Regex.IsMatch(candidate, @"^BTHENUM\\DEV_[0-9A-F]{12}\\", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) continue;
            uint node;
            if (CM_Locate_DevNodeW(out node, candidate, 0) == 0 && ContainerId(node) == container) {
                if (result != null && !String.Equals(result, candidate, StringComparison.OrdinalIgnoreCase)) return null;
                result = candidate.ToUpperInvariant();
            }
        }
        return result;
    }

    private static string NodeProperty(uint node, uint property) {
        PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = property };
        byte[] buffer = new byte[4096]; uint size = (uint)buffer.Length; uint type;
        if (CM_Get_DevNode_PropertyW(node, ref key, out type, buffer, ref size, 0) != 0 || type != 18) return null;
        return Encoding.Unicode.GetString(buffer, 0, (int)size).TrimEnd('\0');
    }

    private static string PhysicalJson(string endpointId) {
        uint node;
        bool found = CM_Locate_DevNodeW(out node, "SWD\\MMDEVAPI\\" + endpointId, 0) == 0;
        string container = found ? ContainerId(node) : null;
        string transport = "unknown", role = null, address = null, physical = null, manufacturer = null;
        string canonical = endpointId;
        if (found) {
            for (int hop = 0; hop < 12; hop++) {
                StringBuilder buffer = new StringBuilder(1024);
                if (CM_Get_Device_IDW(node, buffer, buffer.Capacity, 0) != 0) break;
                string id = buffer.ToString().ToUpperInvariant();
                if (id.StartsWith("BTHLE") || id.StartsWith("BTHLEAUDIO")) transport = "bluetooth-le";
                else if (transport != "bluetooth-le" && (id.StartsWith("BTHENUM\\") || id.StartsWith("BTHHFENUM\\") || id.StartsWith("BTHA2DP\\"))) transport = "bluetooth";
                else if (transport == "unknown" && id.StartsWith("USB\\")) transport = "usb";
                else if (transport == "unknown" && id.StartsWith("HDAUDIO\\")) transport = (id.Contains("VEN_10DE") || id.Contains("VEN_1002")) ? "display-port" : "built-in";
                else if (transport == "unknown" && (id.StartsWith("ROOT\\") || id.StartsWith("SWD\\DRIVERENUM\\"))) transport = "virtual";
                if (id.StartsWith("BTHHFENUM\\")) role = "handsfree";
                if (role == null && (id.StartsWith("BTHA2DP\\") || id.StartsWith("BTHENUM\\{0000110B-"))) role = "a2dp";
                var match = System.Text.RegularExpressions.Regex.Match(id, @"(?:BTHENUM\\DEV_|DEV_)([0-9A-F]{12})(?:\\|$)");
                if (match.Success && (transport == "bluetooth" || transport == "bluetooth-le")) {
                    address = match.Groups[1].Value; canonical = id;
                    physical = NodeProperty(node, 14) ?? NodeProperty(node, 2);
                    manufacturer = NodeProperty(node, 13);
                    break;
                }
                uint parent; if (CM_Get_Parent(out parent, node, 0) != 0) break; node = parent;
            }
        }
        if ((transport == "bluetooth" || transport == "bluetooth-le") && address == null) {
            string remote = FindBluetoothPhysicalNode(container);
            uint remoteNode;
            if (remote != null && CM_Locate_DevNodeW(out remoteNode, remote, 0) == 0) {
                address = System.Text.RegularExpressions.Regex.Match(remote, @"DEV_([0-9A-F]{12})").Groups[1].Value;
                canonical = remote;
                physical = NodeProperty(remoteNode, 14) ?? NodeProperty(remoteNode, 2);
                manufacturer = NodeProperty(remoteNode, 13);
            }
        }
        return ",\"transport\":" + Escape(transport) + ",\"role\":" + Escape(role)
            + ",\"containerId\":" + Escape(container)
            + ",\"bluetoothAddress\":" + Escape(address) + ",\"canonicalId\":" + Escape(canonical)
            + ",\"physicalName\":" + Escape(physical) + ",\"manufacturer\":" + Escape(manufacturer)
            + ",\"pnpFound\":" + (found ? "true" : "false");
    }
    private static string ReadSessions(IMMDevice device) {
        Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        object value;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out value));
        IAudioSessionManager2 manager = (IAudioSessionManager2)value;
        try {
            IAudioSessionEnumerator sessions;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
            try {
                int count; Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
                List<string> records = new List<string>();
                for (int i = 0; i < count; i++) {
                    IAudioSessionControl2 session;
                    if (sessions.GetSession(i, out session) != 0) continue;
                    try {
                        int state; if (session.GetState(out state) != 0 || state != 1) continue;
                        uint pid; int pidResult = session.GetProcessId(out pid);
                        string id; session.GetSessionInstanceIdentifier(out id);
                        string name = "System";
                        if (pid > 0) {
                            try { using (var process = System.Diagnostics.Process.GetProcessById((int)pid)) { name = process.ProcessName; } }
                            catch { name = "Unknown process"; }
                        }
                        // S_FALSE represents a cross-process session: do not attribute it to one PID.
                        if (pidResult != 0) pid = 0;
                        records.Add("{\"pid\":" + pid + ",\"name\":" + Escape(name) + ",\"id\":" + Escape(id) + "}");
                    } finally { Marshal.ReleaseComObject(session); }
                }
                return "[" + String.Join(",", records.ToArray()) + "]";
            } finally { Marshal.ReleaseComObject(sessions); }
        } finally { Marshal.ReleaseComObject(manager); }
    }
    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT pv);

    private static string ReadFriendlyName(IPropertyStore store) {
        PROPERTYKEY key = new PROPERTYKEY();
        key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
        key.pid = 14; // PKEY_Device_FriendlyName
        PROPVARIANT pv = new PROPVARIANT();
        try {
            if (store.GetValue(ref key, out pv) != 0 || pv.vt != 31 || pv.pointerValue == IntPtr.Zero) return null;
            return Marshal.PtrToStringUni(pv.pointerValue);
        } finally { PropVariantClear(ref pv); }
    }

    private static AudioEndpoint ReadEndpoint(IMMDevice device, EDataFlow flow) {
        AudioEndpoint endpoint = new AudioEndpoint();
        endpoint.Flow = flow == EDataFlow.eRender ? "eRender" : "eCapture";
        string id;
        if (device.GetId(out id) != 0) return null;
        endpoint.Id = id;
        IPropertyStore store;
        if (device.OpenPropertyStore(0, out store) == 0) {
            try { endpoint.Name = ReadFriendlyName(store); ReadConfiguredFormat(store, endpoint); } finally { Marshal.ReleaseComObject(store); }
        }
        Guid audioClientIid = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        object unk;
        if (device.Activate(ref audioClientIid, 1, IntPtr.Zero, out unk) != 0) return endpoint;
        IAudioClient client = (IAudioClient)unk;
        IntPtr fmtPtr;
        if (client.GetMixFormat(out fmtPtr) == 0 && fmtPtr != IntPtr.Zero) {
            WAVEFORMATEX wfx = (WAVEFORMATEX)Marshal.PtrToStructure(fmtPtr, typeof(WAVEFORMATEX));
            endpoint.Rate = wfx.sampleRate;
            endpoint.Channels = wfx.channels;
            endpoint.Bits = wfx.bitsPerSample;
            Marshal.FreeCoTaskMem(fmtPtr);
        }
        try { ReadSupportedFormats(client, endpoint); } finally { Marshal.ReleaseComObject(client); }
        try { endpoint.Sessions = ReadSessions(device); endpoint.SessionsKnown = true; } catch { }
        return endpoint;
    }

    private static List<AudioEndpoint> EnumerateEndpoints(IMMDeviceEnumerator enumerator) {
        List<AudioEndpoint> endpoints = new List<AudioEndpoint>();
        foreach (EDataFlow flow in new EDataFlow[] { EDataFlow.eRender, EDataFlow.eCapture }) {
            IMMDeviceCollection collection;
            if (enumerator.EnumAudioEndpoints(flow, 1, out collection) != 0) continue;
            uint count;
            collection.GetCount(out count);
            for (uint i = 0; i < count; i++) {
                IMMDevice device;
                if (collection.Item(i, out device) != 0) continue;
                AudioEndpoint endpoint = ReadEndpoint(device, flow);
                if (endpoint != null) endpoints.Add(endpoint);
                Marshal.ReleaseComObject(device);
            }
            Marshal.ReleaseComObject(collection);
        }
        HashSet<string> present = new HashSet<string>();
        foreach (AudioEndpoint endpoint in endpoints) present.Add(endpoint.Id);
        foreach (string id in new List<string>(formatCache.Keys)) if (!present.Contains(id)) formatCache.Remove(id);
        return endpoints;
    }

    private static string Escape(string s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        foreach (char c in s) {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 32 || c > 126) sb.Append("\\u" + ((int)c).ToString("x4"));
            else sb.Append(c);
        }
        sb.Append("\"");
        return sb.ToString();
    }

    private static string EndpointJson(AudioEndpoint e) {
        return "{\"id\":" + Escape(e.Id)
            + ",\"name\":" + Escape(e.Name)
            + ",\"rate\":" + e.Rate
            + ",\"channels\":" + e.Channels
            + ",\"configuredRate\":" + e.ConfiguredRate + ",\"configuredChannels\":" + e.ConfiguredChannels
            + ",\"configuredStatus\":" + Escape(e.ConfiguredStatus)
            + ",\"supportedRates\":" + e.SupportedRates + ",\"supportedStatus\":" + Escape(e.SupportedStatus)
            + ",\"bits\":" + e.Bits + ",\"flow\":" + Escape(e.Flow) + ",\"sessionsKnown\":" + (e.SessionsKnown ? "true" : "false") + ",\"sessions\":" + e.Sessions + PhysicalJson(e.Id) + "}";
    }

    private static AudioEndpoint FindById(List<AudioEndpoint> endpoints, string id) {
        if (id == null) return null;
        foreach (AudioEndpoint e in endpoints) if (e.Id == id) return e;
        return null;
    }

    private static string DefaultsJson(IMMDeviceEnumerator enumerator, List<AudioEndpoint> endpoints) {
        StringBuilder sb = new StringBuilder();
        sb.Append("{");
        bool first = true;
        foreach (string key in new string[] { "renderConsole", "renderMultimedia", "renderComms", "captureConsole", "captureMultimedia", "captureComms" }) {
            EDataFlow flow = key.StartsWith("render") ? EDataFlow.eRender : EDataFlow.eCapture;
            ERole role = key.EndsWith("Comms") ? ERole.eCommunications : key.EndsWith("Multimedia") ? ERole.eMultimedia : ERole.eConsole;
            IMMDevice device;
            AudioEndpoint endpoint = null;
            if (enumerator.GetDefaultAudioEndpoint(flow, role, out device) == 0) {
                string id;
                device.GetId(out id);
                endpoint = FindById(endpoints, id);
                Marshal.ReleaseComObject(device);
            }
            if (!first) sb.Append(",");
            first = false;
            sb.Append("\"" + key + "\":" + (endpoint == null ? "null" : EndpointJson(endpoint)));
        }
        sb.Append("}");
        return sb.ToString();
    }

    // One-shot probe: {"endpoints":[...],"defaults":{...}}
    public static string ProbeEndpoints() {
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        List<AudioEndpoint> endpoints = EnumerateEndpoints(enumerator);
        StringBuilder sb = new StringBuilder();
        sb.Append("{\"endpoints\":[");
        for (int i = 0; i < endpoints.Count; i++) {
            if (i > 0) sb.Append(",");
            sb.Append(EndpointJson(endpoints[i]));
        }
        sb.Append("],\"defaults\":" + DefaultsJson(enumerator, endpoints) + ",\"voiceLinks\":" + VoiceLinksJson() + "}");
        return sb.ToString();
    }

}

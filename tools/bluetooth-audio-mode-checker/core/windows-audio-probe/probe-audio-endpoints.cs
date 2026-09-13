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
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Locate_DevNodeW(out uint node, string id, uint flags);
    [DllImport("cfgmgr32.dll")]
    private static extern uint CM_Get_Parent(out uint parent, uint node, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_IDW(uint node, StringBuilder id, int length, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_DevNode_PropertyW(uint node, ref PROPERTYKEY key, out uint type, byte[] buffer, ref uint size, uint flags);

    private static string NodeProperty(uint node, uint property) {
        PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = property };
        byte[] buffer = new byte[4096]; uint size = (uint)buffer.Length; uint type;
        if (CM_Get_DevNode_PropertyW(node, ref key, out type, buffer, ref size, 0) != 0 || type != 18) return null;
        return Encoding.Unicode.GetString(buffer, 0, (int)size).TrimEnd('\0');
    }

    private static string PhysicalJson(string endpointId) {
        uint node;
        bool found = CM_Locate_DevNodeW(out node, "SWD\\MMDEVAPI\\" + endpointId, 0) == 0;
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
        return ",\"transport\":" + Escape(transport) + ",\"role\":" + Escape(role)
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
            try { endpoint.Name = ReadFriendlyName(store); } finally { Marshal.ReleaseComObject(store); }
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
        Marshal.ReleaseComObject(client);
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
        sb.Append("],\"defaults\":" + DefaultsJson(enumerator, endpoints) + "}");
        return sb.ToString();
    }

}

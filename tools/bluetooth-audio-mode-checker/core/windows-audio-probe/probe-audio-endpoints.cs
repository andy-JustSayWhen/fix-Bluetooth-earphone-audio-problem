// Windows audio endpoint probe core, shared by full probe and realtime watch.
// Compiled at runtime via PowerShell Add-Type; must stay C# 5 compatible and ASCII only.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
public enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
    int GetCount(out uint count);
    int Item(uint index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(uint stgmAccess, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out uint state);
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
    int GetCount(out uint count);
    int GetAt(uint index, out PROPERTYKEY key);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    int Commit();
}

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
    [FieldOffset(8)] public Int64 int64Value;
    [FieldOffset(8)] public Int32 int32Value;
    [FieldOffset(8)] public UInt32 uint32Value;
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioClient {
    int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    int GetBufferSize(out uint bufferFrames);
    int GetStreamLatency(out long latency);
    int GetCurrentPadding(out uint padding);
    int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
    int GetMixFormat(out IntPtr format);
}

[StructLayout(LayoutKind.Sequential)]
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
}

public static class WindowsAudioProbeCore {
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
            + ",\"bits\":" + e.Bits + "}";
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
        foreach (string key in new string[] { "renderConsole", "renderComms", "captureConsole" }) {
            EDataFlow flow = key.StartsWith("render") ? EDataFlow.eRender : EDataFlow.eCapture;
            ERole role = key.EndsWith("Comms") ? ERole.eCommunications : ERole.eConsole;
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
            sb.Append("{\"flow\":\"" + endpoints[i].Flow + "\",\"endpoint\":" + EndpointJson(endpoints[i]) + "}");
        }
        sb.Append("],\"defaults\":" + DefaultsJson(enumerator, endpoints) + "}");
        return sb.ToString();
    }

    // Realtime watch: prints one JSON line whenever defaults, their mix format, or the endpoint set changes.
    public static void WatchDefaults(int intervalMs) {
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        string lastFingerprint = null;
        while (true) {
            try {
                List<AudioEndpoint> endpoints = EnumerateEndpoints(enumerator);
                string defaults = DefaultsJson(enumerator, endpoints);
                StringBuilder ids = new StringBuilder();
                foreach (AudioEndpoint e in endpoints) { ids.Append(e.Flow); ids.Append(":"); ids.Append(e.Id); ids.Append(";"); }
                string fingerprint = defaults + "|" + ids.ToString();
                if (fingerprint != lastFingerprint) {
                    lastFingerprint = fingerprint;
                    StringBuilder sb = new StringBuilder();
                    sb.Append("{\"defaults\":" + defaults + ",\"endpoints\":[");
                    for (int i = 0; i < endpoints.Count; i++) {
                        if (i > 0) sb.Append(",");
                        sb.Append(EndpointJson(endpoints[i]));
                    }
                    sb.Append("]}");
                    Console.Out.WriteLine(sb.ToString());
                    Console.Out.Flush();
                }
            } catch (Exception) {
                // Transient COM failures must not stop the watch loop.
            }
            Thread.Sleep(intervalMs < 100 ? 100 : intervalMs);
        }
    }
}

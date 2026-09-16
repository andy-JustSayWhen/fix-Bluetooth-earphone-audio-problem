using System;
using System.Runtime.InteropServices;

[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
public class PolicyConfigClient { }
[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfig {
    [PreserveSig] int GetMixFormat(string id, out IntPtr format);
    [PreserveSig] int GetDeviceFormat(string id, int option, out IntPtr format);
    [PreserveSig] int ResetDeviceFormat(string id);
    [PreserveSig] int SetDeviceFormat(string id, IntPtr endpoint, IntPtr mix);
    [PreserveSig] int GetProcessingPeriod(string id, int option, IntPtr period, IntPtr minimum);
    [PreserveSig] int SetProcessingPeriod(string id, IntPtr period);
    [PreserveSig] int GetShareMode(string id, IntPtr mode);
    [PreserveSig] int SetShareMode(string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue(string id, IntPtr key, IntPtr value);
    [PreserveSig] int SetPropertyValue(string id, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility(string id, int visible);
}
public static class WindowsAudioControl {
    private const int CLSCTX_ALL = 23;
    private static readonly Guid BluetoothAudioPropertySet = new Guid("7FA06C40-B8F6-4C7E-8556-E8C33A12E54D");

    public static void SetDefault(string id, int role) {
        var client = (IPolicyConfig)new PolicyConfigClient();
        try { Marshal.ThrowExceptionForHR(client.SetDefaultEndpoint(id, role)); }
        finally { Marshal.ReleaseComObject(client); }
    }

    public static void ReconnectBluetoothAudio(string endpointId) {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        try {
            IMMDevice endpoint;
            Marshal.ThrowExceptionForHR(enumerator.GetDevice(endpointId, out endpoint));
            try {
                IKsControl control = GetBluetoothAudioControl(endpoint);
                if (control == null) throw new InvalidOperationException("Bluetooth audio driver control is unavailable");
                try {
                    var property = new KSPROPERTY { Set = BluetoothAudioPropertySet, Id = 0, Flags = 1 };
                    uint returned;
                    Marshal.ThrowExceptionForHR(control.KsProperty(ref property, (uint)Marshal.SizeOf(typeof(KSPROPERTY)), IntPtr.Zero, 0, out returned));
                } finally { Marshal.ReleaseComObject(control); }
            } finally { Marshal.ReleaseComObject(endpoint); }
        } finally { Marshal.ReleaseComObject(enumerator); }
    }

    private static IKsControl GetBluetoothAudioControl(IMMDevice endpoint) {
        Guid topologyId = typeof(IDeviceTopology).GUID;
        object topologyObject;
        if (endpoint.Activate(ref topologyId, CLSCTX_ALL, IntPtr.Zero, out topologyObject) < 0 || topologyObject == null) return null;
        var topology = (IDeviceTopology)topologyObject;
        try {
            uint count;
            topology.GetConnectorCount(out count);
            for (uint index = 0; index < count; index++) {
                IConnector connector;
                topology.GetConnector(index, out connector);
                try {
                    bool connected;
                    connector.IsConnected(out connected);
                    if (!connected) continue;
                    IConnector other;
                    connector.GetConnectedTo(out other);
                    try {
                        IDeviceTopology otherTopology;
                        ((IPart)other).GetTopologyObject(out otherTopology);
                        try {
                            string deviceId;
                            otherTopology.GetDeviceId(out deviceId);
                            var filterEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                            try {
                                IMMDevice filter;
                                if (filterEnumerator.GetDevice(deviceId, out filter) < 0 || filter == null) continue;
                                try {
                                    Guid controlId = typeof(IKsControl).GUID;
                                    object controlObject;
                                    if (filter.Activate(ref controlId, CLSCTX_ALL, IntPtr.Zero, out controlObject) >= 0 && controlObject != null) return (IKsControl)controlObject;
                                } finally { Marshal.ReleaseComObject(filter); }
                            } finally { Marshal.ReleaseComObject(filterEnumerator); }
                        } finally { Marshal.ReleaseComObject(otherTopology); }
                    } finally { Marshal.ReleaseComObject(other); }
                } finally { Marshal.ReleaseComObject(connector); }
            }
        } finally { Marshal.ReleaseComObject(topology); }
        return null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KSPROPERTY { public Guid Set; public uint Id; public uint Flags; }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class MMDeviceEnumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int flow, int mask, out IntPtr collection);
        int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr callback);
        int UnregisterEndpointNotificationCallback(IntPtr callback);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid id, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        int OpenPropertyStore(int access, out IntPtr store);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }
    [ComImport, Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDeviceTopology {
        int GetConnectorCount(out uint count); int GetConnector(uint index, out IConnector connector);
        int GetSubunitCount(out uint count); int GetSubunit(uint index, out IntPtr subunit);
        int GetPartById(uint id, out IntPtr part); int GetDeviceId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetSignalPath(IntPtr from, IntPtr to, bool rejectMixed, out IntPtr parts);
    }
    [ComImport, Guid("9C2C4058-23F5-41DE-877A-DF3AF236A09E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IConnector {
        int GetType(out int type); int GetDataFlow(out int flow); int ConnectTo(IConnector other); int Disconnect();
        int IsConnected(out bool connected); int GetConnectedTo(out IConnector other);
        int GetConnectorIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id, out IntPtr connector);
        int GetDeviceIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }
    [ComImport, Guid("AE2DE0E4-5BCA-4F2D-AA46-5D13F8FDB3A9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPart {
        int GetName([MarshalAs(UnmanagedType.LPWStr)] out string name); int GetLocalId(out uint id);
        int GetGlobalId([MarshalAs(UnmanagedType.LPWStr)] out string id); int GetPartType(out int type); int GetSubType(out Guid type);
        int GetControlInterfaceCount(out uint count); int GetControlInterface(uint index, out IntPtr control);
        int EnumPartsIncoming(out IntPtr parts); int EnumPartsOutgoing(out IntPtr parts); int GetTopologyObject(out IDeviceTopology topology);
    }
    [ComImport, Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IKsControl {
        [PreserveSig] int KsProperty(ref KSPROPERTY property, uint propertyLength, IntPtr data, uint dataLength, out uint returned);
        [PreserveSig] int KsMethod(IntPtr method, uint methodLength, IntPtr data, uint dataLength, out uint returned);
        [PreserveSig] int KsEvent(IntPtr eventData, uint eventLength, IntPtr data, uint dataLength, out uint returned);
    }
}

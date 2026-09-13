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
    public static void SetDefault(string id, int role) {
        var client = (IPolicyConfig)new PolicyConfigClient();
        try { Marshal.ThrowExceptionForHR(client.SetDefaultEndpoint(id, role)); }
        finally { Marshal.ReleaseComObject(client); }
    }
}

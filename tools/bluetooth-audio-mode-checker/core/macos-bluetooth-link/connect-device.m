#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#import <dispatch/dispatch.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *targetName = [NSString stringWithUTF8String:argv[1]];
    IOBluetoothDevice *target = nil;
    for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) {
      if ([[device name] isEqualToString:targetName]) { target = device; break; }
    }
    if (target == nil) return 3;
    if ([target isConnected]) return 0;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      @autoreleasepool { [target openConnection]; }
    });
    for (NSInteger attempt = 0; attempt < 180 && ![target isConnected]; attempt += 1) {
      [NSThread sleepForTimeInterval:0.1];
    }
    return [target isConnected] ? 0 : 6;
  }
}

#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *targetName = [NSString stringWithUTF8String:argv[1]];
    IOBluetoothDevice *target = nil;
    for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) {
      if ([[device name] isEqualToString:targetName]) { target = device; break; }
    }
    if (target == nil) return 3;
    if ([target isConnected]) {
      if ([target closeConnection] != kIOReturnSuccess) return 4;
      for (NSInteger attempt = 0; attempt < 40 && [target isConnected]; attempt += 1) {
        [NSThread sleepForTimeInterval:0.1];
      }
    }
    [NSThread sleepForTimeInterval:0.8];
    IOReturn result = [target openConnection];
    if (result != kIOReturnSuccess && result != kIOReturnExclusiveAccess) return 5;
    for (NSInteger attempt = 0; attempt < 80 && ![target isConnected]; attempt += 1) {
      [NSThread sleepForTimeInterval:0.1];
    }
    if (![target isConnected]) return 6;
  }
  return 0;
}

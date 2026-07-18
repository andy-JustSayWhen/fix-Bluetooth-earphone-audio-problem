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
    if (![target isConnected]) return 0;
    if ([target closeConnection] != kIOReturnSuccess) return 4;
    for (NSInteger attempt = 0; attempt < 50 && [target isConnected]; attempt += 1) {
      [NSThread sleepForTimeInterval:0.1];
    }
    if ([target isConnected]) return 5;
  }
  return 0;
}

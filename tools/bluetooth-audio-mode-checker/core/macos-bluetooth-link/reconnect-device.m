#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "必须提供蓝牙设备名称。\n");
      return 2;
    }

    NSString *targetName = [NSString stringWithUTF8String:argv[1]];
    IOBluetoothDevice *target = nil;
    for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) {
      if ([[device name] isEqualToString:targetName]) {
        target = device;
        break;
      }
    }
    if (target == nil) {
      fprintf(stderr, "未找到已配对的目标蓝牙设备。\n");
      return 3;
    }

    if ([target isConnected]) {
      IOReturn closeResult = [target closeConnection];
      if (closeResult != kIOReturnSuccess) {
        fprintf(stderr, "蓝牙连接未能断开。\n");
        return 4;
      }
      for (NSInteger attempt = 0; attempt < 30 && [target isConnected]; attempt += 1) {
        [NSThread sleepForTimeInterval:0.1];
      }
    }

    [NSThread sleepForTimeInterval:0.6];
    IOReturn openResult = [target openConnection];
    if (openResult != kIOReturnSuccess) {
      fprintf(stderr, "蓝牙设备未能重新连接。\n");
      return 5;
    }
    for (NSInteger attempt = 0; attempt < 60 && ![target isConnected]; attempt += 1) {
      [NSThread sleepForTimeInterval:0.1];
    }
    if (![target isConnected]) {
      fprintf(stderr, "等待蓝牙设备重新连接超时。\n");
      return 6;
    }
  }
  return 0;
}

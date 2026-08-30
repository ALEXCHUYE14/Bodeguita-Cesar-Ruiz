// Tipado minimo de Web Bluetooth — esta API no forma parte de las
// definiciones estandar de TypeScript (lib.dom.d.ts). Se declara aqui
// unicamente lo que el proyecto usa, en vez de instalar el paquete completo
// @types/web-bluetooth como dependencia nueva.
// Ver uso en: src/utils/bluetoothPrint.ts

export {}

declare global {
  interface BluetoothRemoteGATTCharacteristic {
    writeValue(value: BufferSource): Promise<void>
    writeValueWithoutResponse?(value: BufferSource): Promise<void>
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean
    connect(): Promise<BluetoothRemoteGATTServer>
    disconnect(): void
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>
  }

  interface BluetoothDevice {
    name?: string
    gatt?: BluetoothRemoteGATTServer
  }

  interface BluetoothRequestDeviceOptions {
    acceptAllDevices?: boolean
    filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>
    optionalServices?: string[]
  }

  interface Bluetooth {
    requestDevice(options?: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>
  }

  interface Navigator {
    bluetooth?: Bluetooth
  }
}

export type EscPosTicketLine = {
  quantity: number;
  name: string;
  options: string[];
};

type GattCharacteristic = {
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
  };
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
};

type GattService = {
  getCharacteristic(uuid: string): Promise<GattCharacteristic>;
};

type GattServer = {
  connected: boolean;
  connect(): Promise<GattServer>;
  getPrimaryService(uuid: string): Promise<GattService>;
  disconnect(): void;
};

type BluetoothPrinterDevice = {
  id: string;
  name?: string;
  gatt?: GattServer;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
};

type BluetoothApi = {
  requestDevice(options: {
    acceptAllDevices: true;
    optionalServices: string[];
  }): Promise<BluetoothPrinterDevice>;
};

type NavigatorWithBluetooth = Navigator & {
  bluetooth?: BluetoothApi;
};

const PRINTER_PROFILES = [
  {
    service: "000018f0-0000-1000-8000-00805f9b34fb",
    characteristic: "00002af1-0000-1000-8000-00805f9b34fb",
  },
  {
    service: "0000ff00-0000-1000-8000-00805f9b34fb",
    characteristic: "0000ff02-0000-1000-8000-00805f9b34fb",
  },
] as const;

let selectedPrinter: BluetoothPrinterDevice | null = null;

function escposCommand(...bytes: number[]) {
  return new Uint8Array(bytes);
}

function ascii(value: string) {
  return new TextEncoder().encode(value.replace(/[^\x20-\x7e]/g, "?"));
}

function joinBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function buildOrderToMakeTicket(
  lines: EscPosTicketLine[],
  details: { ticketNo?: string; dateLabel?: string } = {},
) {
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);
  const parts = [
    escposCommand(0x1b, 0x40),
    escposCommand(0x1b, 0x61, 0x01),
    escposCommand(0x1d, 0x21, 0x11),
    escposCommand(0x1b, 0x45, 0x01),
    ascii("MAKE THESE DRINKS\n"),
    escposCommand(0x1b, 0x45, 0x00),
    escposCommand(0x1d, 0x21, 0x00),
    ascii("--------------------------------\n"),
    ascii(`ORDER NO. ${details.ticketNo || "---"}\n`),
    ascii(`${details.dateLabel ?? ""}\n`),
    ascii("--------------------------------\n"),
    ascii("Qty   Item\n"),
    ascii("--------------------------------\n"),
    escposCommand(0x1b, 0x61, 0x00),
  ];

  for (const line of lines) {
    parts.push(
      escposCommand(0x1b, 0x45, 0x01),
      ascii(`${line.quantity}x    ${line.name.toLocaleUpperCase()}\n`),
      escposCommand(0x1b, 0x45, 0x00),
    );
    if (line.options.length > 0) {
      parts.push(ascii(`      ${line.options.join(" / ")}\n`));
    }
  }

  parts.push(
    ascii("--------------------------------\n"),
    escposCommand(0x1b, 0x61, 0x01),
    escposCommand(0x1b, 0x45, 0x01),
    ascii(`${itemCount} DRINK${itemCount === 1 ? "" : "S"} TO MAKE\n`),
    escposCommand(0x1b, 0x45, 0x00),
    ascii("\n\n"),
    escposCommand(0x1d, 0x56, 0x00),
  );
  return joinBytes(parts);
}

async function connectPrinter(device: BluetoothPrinterDevice) {
  if (!device.gatt) {
    throw new Error("This device does not provide a Bluetooth GATT connection.");
  }
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();

  for (const profile of PRINTER_PROFILES) {
    try {
      const service = await server.getPrimaryService(profile.service);
      const characteristic = await service.getCharacteristic(profile.characteristic);
      if (
        characteristic.properties.write ||
        characteristic.properties.writeWithoutResponse
      ) {
        return { server, characteristic };
      }
    } catch {
      // Try the next known ESC/POS BLE profile.
    }
  }

  server.disconnect();
  throw new Error(
    "The selected printer's BLE profile is not supported. Use an ESC/POS BLE printer with service 18F0/characteristic 2AF1 or service FF00/characteristic FF02.",
  );
}

async function sendBytes(characteristic: GattCharacteristic, bytes: Uint8Array) {
  const chunkSize = 20;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    if (characteristic.properties.write && characteristic.writeValueWithResponse) {
      await characteristic.writeValueWithResponse(chunk);
    } else if (characteristic.properties.write && characteristic.writeValue) {
      await characteristic.writeValue(chunk);
    } else if (
      characteristic.properties.writeWithoutResponse &&
      characteristic.writeValueWithoutResponse
    ) {
      await characteristic.writeValueWithoutResponse(chunk);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } else {
      throw new Error("The selected printer does not allow ESC/POS data writes.");
    }
  }
}

export async function printOrderToMake(
  lines: EscPosTicketLine[],
  details: { ticketNo?: string; dateLabel?: string } = {},
) {
  if (lines.length === 0) {
    throw new Error("Add items to the order before printing.");
  }

  if (!window.isSecureContext) {
    throw new Error("Bluetooth printing requires HTTPS or localhost.");
  }

  const bluetooth = (navigator as NavigatorWithBluetooth).bluetooth;
  if (!bluetooth) {
    throw new Error("Web Bluetooth is unavailable. Open the POS in Chrome on the Android tablet.");
  }

  if (!selectedPrinter) {
    try {
      selectedPrinter = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_PROFILES.map((profile) => profile.service),
      });
      selectedPrinter.addEventListener("gattserverdisconnected", () => {
        selectedPrinter = null;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error("No Bluetooth printer was selected.");
      }
      throw error;
    }
  }

  const { server, characteristic } = await connectPrinter(selectedPrinter);
  const printerName = selectedPrinter.name || "the printer";
  try {
    await sendBytes(characteristic, buildOrderToMakeTicket(lines, details));
  } catch (error) {
    server.disconnect();
    selectedPrinter = null;
    throw new Error(
      `Could not send the ticket to ${printerName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PaperWidth } from "@/lib/escpos";

export type PrinterRole = "label" | "receipt";
export type PrinterStatus = "unsupported" | "disconnected" | "connected";

type StoredSerialConfig = {
  baudRate: number;
  paperWidth: PaperWidth;
  usbVendorId?: number;
  usbProductId?: number;
};

export type SerialPrinterConnection = {
  role: PrinterRole;
  transport: "web-serial";
  protocol: "escpos";
  supported: boolean;
  connected: boolean;
  status: PrinterStatus;
  baudRate: number;
  paperWidth: PaperWidth;
  setBaudRate: (baudRate: number) => void;
  setPaperWidth: (paperWidth: PaperWidth) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  write: (data: Uint8Array) => Promise<void>;
};

const claimedPorts = new Map<SerialPort, PrinterRole>();

function serialAvailable(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

function storageKey(role: PrinterRole): string {
  return `coffeezz_${role}_printer_config`;
}

function readStoredConfig(
  role: PrinterRole,
  defaults: StoredSerialConfig,
): StoredSerialConfig {
  if (typeof window === "undefined") return defaults;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey(role)) ?? "null",
    ) as Partial<StoredSerialConfig> | null;
    return {
      baudRate:
        parsed && Number.isSafeInteger(parsed.baudRate) && parsed.baudRate! > 0
          ? parsed.baudRate!
          : defaults.baudRate,
      paperWidth:
        parsed?.paperWidth === 58 || parsed?.paperWidth === 80
          ? parsed.paperWidth
          : defaults.paperWidth,
      usbVendorId: parsed?.usbVendorId,
      usbProductId: parsed?.usbProductId,
    };
  } catch {
    return defaults;
  }
}

function writeStoredConfig(role: PrinterRole, config: StoredSerialConfig) {
  window.localStorage.setItem(storageKey(role), JSON.stringify(config));
}

function sameDevice(config: StoredSerialConfig, port: SerialPort): boolean {
  const info = port.getInfo();
  if (config.usbVendorId === undefined || config.usbProductId === undefined) {
    return false;
  }
  return (
    info.usbVendorId === config.usbVendorId &&
    info.usbProductId === config.usbProductId
  );
}

export function useSerialPrinter({
  role,
  defaultPaperWidth,
  defaultBaudRate = 9600,
}: {
  role: PrinterRole;
  defaultPaperWidth: PaperWidth;
  defaultBaudRate?: number;
}): SerialPrinterConnection {
  const portRef = useRef<SerialPort | null>(null);
  const configRef = useRef<StoredSerialConfig>({
    baudRate: defaultBaudRate,
    paperWidth: defaultPaperWidth,
  });
  const [status, setStatus] = useState<PrinterStatus>("disconnected");
  const [baudRate, setBaudRateState] = useState(defaultBaudRate);
  const [paperWidth, setPaperWidthState] =
    useState<PaperWidth>(defaultPaperWidth);

  const openPort = useCallback(
    async (port: SerialPort, config: StoredSerialConfig) => {
      const owner = claimedPorts.get(port);
      if (owner && owner !== role) {
        throw new Error(
          `That device is already assigned to the ${owner} printer.`,
        );
      }
      if (!port.writable) {
        await port.open({ baudRate: config.baudRate, bufferSize: 4096 });
      }
      try {
        await port.setSignals({ dataTerminalReady: true, requestToSend: true });
      } catch {
        // Some USB serial adapters do not expose modem signals.
      }
      claimedPorts.set(port, role);
      portRef.current = port;
      setStatus("connected");
    },
    [role],
  );

  const closePort = useCallback(async () => {
    const port = portRef.current;
    portRef.current = null;
    if (!port) return;
    claimedPorts.delete(port);
    try {
      await port.close();
    } catch {
      // The device may already be closed or physically disconnected.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!serialAvailable()) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      const stored = readStoredConfig(role, {
        baudRate: defaultBaudRate,
        paperWidth: defaultPaperWidth,
      });
      configRef.current = stored;
      if (!cancelled) {
        setBaudRateState(stored.baudRate);
        setPaperWidthState(stored.paperWidth);
      }

      try {
        const ports = (await navigator.serial.getPorts()).filter((port) =>
          sameDevice(stored, port),
        );
        if (ports.length !== 1 || cancelled || claimedPorts.has(ports[0])) return;
        await openPort(ports[0], stored);
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [defaultBaudRate, defaultPaperWidth, openPort, role]);

  const connect = useCallback(async () => {
    if (!serialAvailable()) {
      throw new Error("Use Chrome or Edge on the POS computer for Web Serial.");
    }
    const port = await navigator.serial.requestPort();
    await closePort();
    setStatus("disconnected");
    const info = port.getInfo();
    const config = {
      ...configRef.current,
      usbVendorId: info.usbVendorId,
      usbProductId: info.usbProductId,
    };
    await openPort(port, config);
    configRef.current = config;
    writeStoredConfig(role, config);
  }, [closePort, openPort, role]);

  const disconnect = useCallback(async () => {
    await closePort();
    setStatus(serialAvailable() ? "disconnected" : "unsupported");
  }, [closePort]);

  const setPaperWidth = useCallback(
    (next: PaperWidth) => {
      const config = { ...configRef.current, paperWidth: next };
      configRef.current = config;
      setPaperWidthState(next);
      writeStoredConfig(role, config);
    },
    [role],
  );

  const setBaudRate = useCallback(
    (next: number) => {
      if (!Number.isSafeInteger(next) || next <= 0) return;
      const config = { ...configRef.current, baudRate: next };
      configRef.current = config;
      setBaudRateState(next);
      writeStoredConfig(role, config);
    },
    [role],
  );

  const write = useCallback(async (data: Uint8Array) => {
    const port = portRef.current;
    if (!port?.writable) {
      throw new Error("Printer is not connected.");
    }
    const writer = port.writable.getWriter();
    try {
      await writer.write(data);
    } catch (error) {
      setStatus("disconnected");
      throw error;
    } finally {
      writer.releaseLock();
    }
  }, []);

  return {
    role,
    transport: "web-serial",
    protocol: "escpos",
    supported: status !== "unsupported",
    connected: status === "connected",
    status,
    baudRate,
    paperWidth,
    setBaudRate,
    setPaperWidth,
    connect,
    disconnect,
    write,
  };
}

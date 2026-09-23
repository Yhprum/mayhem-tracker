import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  INVOKE_CHANNELS,
  type ElectronAPI,
  type InvokeMethod,
  type RendererEvents,
} from "../shared/api";

type Handler<K extends InvokeMethod> = (
  event: IpcMainInvokeEvent,
  ...args: Parameters<ElectronAPI[K]>
) => ReturnType<ElectronAPI[K]> | Awaited<ReturnType<ElectronAPI[K]>>;

// The main-process half of one ElectronAPI request, registered on the channel
// the preload sends it down. The handler is checked against the signature of
// the method it answers, arguments and result both.
export function handle<K extends InvokeMethod>(method: K, handler: Handler<K>): void {
  ipcMain.handle(
    INVOKE_CHANNELS[method],
    handler as (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  );
}

// Pushes one event to a window, which may have closed since the caller got hold
// of it. Events without a payload take no argument.
export function sendToRenderer<C extends keyof RendererEvents>(
  win: BrowserWindow | null | undefined,
  channel: C,
  ...payload: RendererEvents[C] extends void ? [] : [RendererEvents[C]]
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...payload);
}

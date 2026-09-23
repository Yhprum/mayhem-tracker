import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  INVOKE_CHANNELS,
  LOCALE_SWITCH,
  type ElectronAPI,
  type InvokeMethod,
  type RendererEvents,
} from "../shared/api";

// Every request method, each a straight pass-through to its channel. Built from
// the channel map rather than written out, so there is no second list to keep
// in step with the one ipc-handlers registers from. The cast is what the map's
// own `satisfies` check makes safe: it names every request method, and nothing
// else.
const requests = Object.fromEntries(
  Object.entries(INVOKE_CHANNELS).map(([method, channel]) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
) as Pick<ElectronAPI, InvokeMethod>;

// Listens for one of the events the main process pushes, handing back the
// function that stops listening.
function subscribe<C extends keyof RendererEvents>(channel: C) {
  return (callback: (payload: RendererEvents[C]) => void) => {
    const handler = (_event: IpcRendererEvent, payload: RendererEvents[C]) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

// The switch the main process created this window with, if it had a locale to
// pass on
const localeArgument = process.argv.find((arg) => arg.startsWith(`${LOCALE_SWITCH}=`));

// Annotated rather than inferred, so the compiler checks the whole bridge
// against the contract the renderer calls through.
const api: ElectronAPI = {
  locale: localeArgument?.slice(LOCALE_SWITCH.length + 1),
  ...requests,
  onBackfillDone: subscribe("lcu:backfill-done"),
  onBackfillProgress: subscribe("lcu:backfill-progress"),
  onLiveGame: subscribe("live:changed"),
  onChallengesChanged: subscribe("challenges:changed"),
  onStatusChanged: subscribe("lcu:status-changed"),
  onGamesUpdated: subscribe("lcu:games-updated"),
  onUpdateProgress: subscribe("update:progress"),
  onImportProgress: subscribe("data:import-progress"),
  onMaximizedChanged: subscribe("window:maximized-changed"),
};

contextBridge.exposeInMainWorld("api", api);

import fs from "fs";
import net from "net";
import path from "path";
import type { Credentials } from "league-connect";

// The League client advertises itself for as long as it runs, in a lockfile in
// its install directory: "LeagueClient:<pid>:<port>:<password>:<protocol>".
// Finding it is a file read. league-connect's authenticate() finds the same port
// and password by launching PowerShell to read the process's command line,
// about a quarter second of CPU each time and twice over when the client isn't
// there, so it is only the fallback for an install whose location nothing
// records.

// Where the Riot Client puts League unless told otherwise
const DEFAULT_INSTALL_DIR = "C:\\Riot Games\\League of Legends";

// A lockfile can outlive a client that didn't shut down cleanly, so the port it
// names has to be answering before it counts. A local port refuses or accepts
// at once; the timeout only covers a probe that does neither.
const PROBE_TIMEOUT_MS = 1_000;

// Riot's root for the certificates the client serves on localhost, valid until
// 2043. league-connect bundles the same one for the credentials authenticate()
// returns but doesn't export it, and credentials without one leave the event
// socket unverified.
const RIOT_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIEIDCCAwgCCQDJC+QAdVx4UDANBgkqhkiG9w0BAQUFADCB0TELMAkGA1UEBhMC
VVMxEzARBgNVBAgTCkNhbGlmb3JuaWExFTATBgNVBAcTDFNhbnRhIE1vbmljYTET
MBEGA1UEChMKUmlvdCBHYW1lczEdMBsGA1UECxMUTG9MIEdhbWUgRW5naW5lZXJp
bmcxMzAxBgNVBAMTKkxvTCBHYW1lIEVuZ2luZWVyaW5nIENlcnRpZmljYXRlIEF1
dGhvcml0eTEtMCsGCSqGSIb3DQEJARYeZ2FtZXRlY2hub2xvZ2llc0ByaW90Z2Ft
ZXMuY29tMB4XDTEzMTIwNDAwNDgzOVoXDTQzMTEyNzAwNDgzOVowgdExCzAJBgNV
BAYTAlVTMRMwEQYDVQQIEwpDYWxpZm9ybmlhMRUwEwYDVQQHEwxTYW50YSBNb25p
Y2ExEzARBgNVBAoTClJpb3QgR2FtZXMxHTAbBgNVBAsTFExvTCBHYW1lIEVuZ2lu
ZWVyaW5nMTMwMQYDVQQDEypMb0wgR2FtZSBFbmdpbmVlcmluZyBDZXJ0aWZpY2F0
ZSBBdXRob3JpdHkxLTArBgkqhkiG9w0BCQEWHmdhbWV0ZWNobm9sb2dpZXNAcmlv
dGdhbWVzLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKoJemF/
6PNG3GRJGbjzImTdOo1OJRDI7noRwJgDqkaJFkwv0X8aPUGbZSUzUO23cQcCgpYj
21ygzKu5dtCN2EcQVVpNtyPuM2V4eEGr1woodzALtufL3Nlyh6g5jKKuDIfeUBHv
JNyQf2h3Uha16lnrXmz9o9wsX/jf+jUAljBJqsMeACOpXfuZy+YKUCxSPOZaYTLC
y+0GQfiT431pJHBQlrXAUwzOmaJPQ7M6mLfsnpHibSkxUfMfHROaYCZ/sbWKl3lr
ZA9DbwaKKfS1Iw0ucAeDudyuqb4JntGU/W0aboKA0c3YB02mxAM4oDnqseuKV/CX
8SQAiaXnYotuNXMCAwEAATANBgkqhkiG9w0BAQUFAAOCAQEAf3KPmddqEqqC8iLs
lcd0euC4F5+USp9YsrZ3WuOzHqVxTtX3hR1scdlDXNvrsebQZUqwGdZGMS16ln3k
WObw7BbhU89tDNCN7Lt/IjT4MGRYRE+TmRc5EeIXxHkQ78bQqbmAI3GsW+7kJsoO
q3DdeE+M+BUJrhWorsAQCgUyZO166SAtKXKLIcxa+ddC49NvMQPJyzm3V+2b1roP
SvD2WV8gRYUnGmy/N0+u6ANq5EsbhZ548zZc+BI4upsWChTLyxt2RxR7+uGlS1+5
EcGfKZ+g024k/J32XP4hdho7WYAS2xMiV83CfLR/MNi8oSMaVQTdKD8cpgiWJk3L
XWehWA==
-----END CERTIFICATE-----`;

export type ClientLookup =
  // A lockfile whose client is answering on the port it names
  | { state: "running"; credentials: Credentials }
  // An install is there and no client in it is running
  | { state: "closed" }
  // No install found, or a lockfile that couldn't be read: only the process
  // itself can say whether the client is up
  | { state: "unknown" };

// The Riot Client keeps a settings file per product and patchline (live, PBE),
// and the League ones name the folder the lockfile is written to. Read on every
// lookup rather than cached, so a reinstall somewhere else is picked up without
// a restart.
function recordedInstallDirs(): string[] {
  const root = path.join(process.env.ProgramData ?? "C:\\ProgramData", "Riot Games", "Metadata");
  let products: string[];
  try {
    products = fs.readdirSync(root);
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const product of products) {
    // The ".game_patch" entries beside each patchline are not installs
    if (!/^league_of_legends\.[a-z]+$/.test(product)) continue;
    try {
      const settings = fs.readFileSync(
        path.join(root, product, `${product}.product_settings.yaml`),
        "utf8",
      );
      const match = settings.match(/^product_install_full_path:\s*"?([^"\r\n]+?)"?\s*$/m);
      if (match) dirs.push(match[1]);
    } catch {
      // A product without a settings file has nothing to say about where it is
    }
  }
  return dirs;
}

/**
 * Every folder the client could be running from, most specific first: where it
 * last said it was, then the Riot Client's records, then the default.
 */
export function installDirCandidates(reported: string | null): string[] {
  const seen = new Set<string>();
  return [...(reported ? [reported] : []), ...recordedInstallDirs(), DEFAULT_INSTALL_DIR].filter(
    (dir) => {
      const key = path.resolve(dir).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );
}

function parseLockfile(text: string): Credentials | null {
  const match = text.trim().match(/^[^:]+:(\d+):(\d+):(.+):https?$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    port: Number(match[2]),
    password: match[3],
    certificate: RIOT_ROOT_CA,
  };
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const settle = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

/**
 * Whether the client is running, and its credentials when it is, from the
 * lockfile in whichever of `dirs` holds one. Launches nothing.
 */
export async function findClient(dirs: string[]): Promise<ClientLookup> {
  let installed = false;
  let unreadable = false;

  for (const dir of dirs) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, "lockfile"), "utf8");
    } catch (err: any) {
      // A missing lockfile in a real install is a closed client. Any other
      // failure means we couldn't look, which says nothing either way.
      if (err?.code !== "ENOENT") unreadable = true;
      else if (fs.existsSync(path.join(dir, "LeagueClient.exe"))) installed = true;
      continue;
    }

    const credentials = parseLockfile(text);
    if (!credentials) {
      unreadable = true;
      continue;
    }
    installed = true;
    if (await isListening(credentials.port)) return { state: "running", credentials };
  }

  return installed && !unreadable ? { state: "closed" } : { state: "unknown" };
}

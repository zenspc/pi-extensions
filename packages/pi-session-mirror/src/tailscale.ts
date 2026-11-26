import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connectionFor } from "./connections.ts";
import { object, PORT } from "./protocol.ts";

const DEFAULT_HTTPS_PORT = "8443";
const upstream = `http://127.0.0.1:${PORT}`;

export function serveRoute(config: unknown, hostname: string, port: string): "ready" | "free" | "conflict" {
  if (config === null) return "free";
  if (!object(config)) return "conflict";
  const tcp = config.TCP ?? {};
  const web = config.Web ?? {};
  const foreground = config.Foreground ?? {};
  const funnel = config.AllowFunnel ?? {};
  if (!object(tcp) || !object(web) || !object(foreground) || !object(funnel)) return "conflict";
  const key = `${hostname}:${port}`;
  if (Object.values(foreground).some((entry) => serveRoute(entry, hostname, port) !== "free") ||
      Object.entries(funnel).some(([address, enabled]) => address.endsWith(`:${port}`) && enabled !== false)) {
    return "conflict";
  }
  const routes = Object.keys(web).filter((address) => address.endsWith(`:${port}`));
  if (!(port in tcp) && routes.length === 0) return "free";
  const listener = tcp[port];
  const route = web[key];
  if (routes.length !== 1 || !object(listener) || listener.HTTPS !== true || !object(route) || !object(route.Handlers)) return "conflict";
  const root = route.Handlers["/"];
  return Object.keys(route.Handlers).length === 1 && object(root) && root.Proxy === upstream ? "ready" : "conflict";
}

async function tailscale(exec: ExtensionAPI["exec"], args: string[]) {
  const result = await exec("tailscale", args, { cwd: homedir(), timeout: 10_000 }).catch(() => undefined);
  return result?.code === 0 && !result.killed ? result.stdout : undefined;
}

async function readServeRoute(exec: ExtensionAPI["exec"], hostname: string, port: string) {
  const output = await tailscale(exec, ["serve", "status", "--json"]);
  if (output === undefined) throw new Error("Could not read Tailscale Serve settings. Check that your user can manage Serve.");
  const config: unknown = JSON.parse(output);
  return serveRoute(config, hostname, port);
}

export async function setupTailscale(exec: ExtensionAPI["exec"], ui: Pick<ExtensionContext["ui"], "confirm">, savedOrigin?: string) {
  const status = await tailscale(exec, ["status", "--json"]);
  if (status === undefined) throw new Error("Install Tailscale on the host and connect it before running this setup.");
  const value: unknown = JSON.parse(status);
  if (!object(value) || value.BackendState !== "Running" || !object(value.Self) || typeof value.Self.DNSName !== "string") {
    throw new Error("Connect this host to Tailscale and enable its DNS name, then try again.");
  }
  const port = savedOrigin ? new URL(savedOrigin).port || "443" : DEFAULT_HTTPS_PORT;
  const hostname = value.Self.DNSName.replace(/\.$/, "").toLowerCase();
  const connection = connectionFor("tailscale", `https://${hostname}:${port}`);
  if (!connection || new URL(connection.origin).hostname !== hostname) throw new Error("Tailscale did not report a valid HTTPS hostname.");

  const route = () => readServeRoute(exec, hostname, port);
  const conflict = new Error(`Tailscale port ${port} is already in use. Pi did not change it. Configure a dedicated Serve HTTPS port manually and use /mirror start <https-url>.`);
  let current = await route();
  if (current === "conflict") throw conflict;
  if (current === "free") {
    if (!await ui.confirm("Set up private Tailscale Serve?",
      `Use ${connection.origin} for Pi. First make sure your Tailscale policy only grants access to your account or devices.`)) return;
    current = await route();
    if (current === "conflict") throw conflict;
    if (current === "free") {
      const args = ["serve", "--bg", `--https=${port}`, upstream];
      if (await tailscale(exec, args) === undefined || await route() !== "ready") {
        throw new Error(`Tailscale could not finish setup in Pi. Run 'tailscale ${args.join(" ")}' in a terminal to see any permission or HTTPS approval prompts, then retry /mirror.`);
      }
    }
  }
  return connection;
}

export async function stopTailscale(exec: ExtensionAPI["exec"], origin: string) {
  const { hostname, port: configuredPort } = new URL(origin);
  const port = configuredPort || "443";
  const route = await readServeRoute(exec, hostname, port);
  if (route === "free") return "Tailscale Serve was already off.";
  if (route === "conflict") return `Tailscale Serve left unchanged: port ${port} has a different or shared route.`;

  const args = ["serve", "--bg", `--https=${port}`, "off"];
  if (await tailscale(exec, args) === undefined || await readServeRoute(exec, hostname, port) !== "free") {
    throw new Error(`Could not stop the Tailscale Serve route on port ${port}. Check 'tailscale serve status' and your Serve permissions.`);
  }
  return `Tailscale Serve stopped on port ${port}.`;
}

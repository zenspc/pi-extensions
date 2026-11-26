import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { object } from "./protocol.ts";

export type Mode = "tailscale";
export type Connection = { mode: Mode; origin: string };

export function isMode(value: unknown): value is Mode {
  return value === "tailscale";
}

export function connectionFor(mode: Mode, input: string): Connection | undefined {
  if (!/^https:\/\//i.test(input) || input.length > 320) return;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        url.hostname.length > 253 || url.hostname.endsWith(".") || url.origin === "null") return;
    if (!/^(?:[a-z0-9-]+\.){2,}ts\.net$/.test(url.hostname)) return;
    return { mode, origin: url.origin };
  } catch { /* Invalid origin. */ }
}

export function parseConnection(value: unknown): Connection | undefined {
  if (!object(value) || !isMode(value.mode) || typeof value.origin !== "string") return;
  const connection = connectionFor(value.mode, value.origin);
  if (connection?.origin === value.origin) return connection;
}

export function parseConnections(value: unknown): Connection[] | undefined {
  if (!Array.isArray(value) || value.length > 1) return;
  const connections: Connection[] = [];
  for (const element of value) {
    const connection = parseConnection(element);
    if (!connection || connections.some((existing) => existing.mode === connection.mode)) return;
    connections.push(connection);
  }
  return connections;
}

export function withConnection(connections: Connection[], newConnection: Connection) {
  return [...connections.filter(({ mode }) => mode !== newConnection.mode), newConnection];
}

export function loadConnections(dir: string) {
  const path = join(dir, "connections.json");
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.geteuid?.() || stat.size > 2_048) {
    throw new Error("Mirror connection settings must be a small private file owned by your user.");
  }
  const saved: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(saved) || saved.length > 2) throw new Error("Invalid mirror connection settings.");
  // Discard the retired LAN mode without losing a saved Tailscale connection.
  const connections = parseConnections(saved.filter((value) => !object(value) || value.mode !== "lan"));
  if (!connections) throw new Error("Invalid mirror connection settings.");
  return connections;
}

export function saveConnections(dir: string, connections: Connection[]) {
  const draft = join(dir, `.connections-${randomUUID()}`);
  try {
    writeFileSync(draft, JSON.stringify(connections) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(draft, join(dir, "connections.json"));
  } finally {
    rmSync(draft, { force: true });
  }
}

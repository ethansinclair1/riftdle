import { DiscordSDK } from "@discord/embedded-app-sdk";

export const DISCORD_CLIENT_ID = "1549817799348846675";

export function isInDiscord(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".discordsays.com");
}

// Inside Discord, the counter API is proxied through the same discordsays.com
// origin (see the /api URL Mapping in the dev portal) instead of hitting the
// Render URL directly, which the sandboxed iframe would otherwise block.
export function apiBase(): string {
  if (isInDiscord()) return "";
  return "https://riftdle-server.onrender.com";
}

let readyPromise: Promise<void> | null = null;

// Riftdle is single-player, so unlike a multiplayer activity there's no need
// to authorize/authenticate to read the player's identity - just the ready()
// handshake, which is required before Discord will render the iframe at all.
export function setupDiscord(): Promise<void> {
  if (!isInDiscord()) return Promise.resolve();
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const sdk = new DiscordSDK(DISCORD_CLIENT_ID);
    await sdk.ready();
  })();

  return readyPromise;
}

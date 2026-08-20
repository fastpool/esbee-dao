// A Nostr relay in memory, for `chat-e2e.mjs`.
//
// EVENT, REQ and CLOSE, the filters NIP-01 names, replaceable kinds kept one
// per key -- enough for the page to hold a conversation with itself without a
// public relay hearing about it.
import { WebSocketServer } from "ws";

export function startRelay(port) {
  const events = [];
  const subs = new Map(); // ws -> Map<subid, filters>
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });

  const matches = (ev, f) => {
    if (f.ids && !f.ids.some((id) => ev.id.startsWith(id))) return false;
    if (f.authors && !f.authors.some((a) => ev.pubkey.startsWith(a))) return false;
    if (f.kinds && !f.kinds.includes(ev.kind)) return false;
    if (f.since && ev.created_at < f.since) return false;
    if (f.until && ev.created_at > f.until) return false;
    for (const key of Object.keys(f)) {
      if (key.startsWith("#")) {
        const tag = key.slice(1);
        const wanted = f[key];
        if (!ev.tags.some((t) => t[0] === tag && wanted.includes(t[1]))) return false;
      }
    }
    return true;
  };

  wss.on("connection", (ws) => {
    subs.set(ws, new Map());
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const [type, a, ...rest] = msg;
      if (type === "EVENT") {
        const ev = a;
        if (!events.some((e) => e.id === ev.id)) {
          // replaceable / addressable: drop older of same (pubkey, kind, d)
          if ((ev.kind >= 10000 && ev.kind < 20000) || (ev.kind >= 30000 && ev.kind < 40000) || ev.kind === 0) {
            const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
            for (let i = events.length - 1; i >= 0; i--) {
              const e = events[i];
              if (e.kind === ev.kind && e.pubkey === ev.pubkey && (e.tags.find((t) => t[0] === "d")?.[1] ?? "") === d) {
                events.splice(i, 1);
              }
            }
          }
          events.push(ev);
          for (const [client, map] of subs) {
            for (const [id, filters] of map) {
              if (filters.some((f) => matches(ev, f))) client.send(JSON.stringify(["EVENT", id, ev]));
            }
          }
        }
        ws.send(JSON.stringify(["OK", ev.id, true, ""]));
      } else if (type === "REQ") {
        const id = a;
        const filters = rest;
        subs.get(ws).set(id, filters);
        let out = events.filter((ev) => filters.some((f) => matches(ev, f)));
        out.sort((x, y) => y.created_at - x.created_at);
        const limit = Math.min(...filters.map((f) => f.limit ?? Infinity));
        if (Number.isFinite(limit)) out = out.slice(0, limit);
        for (const ev of out.reverse()) ws.send(JSON.stringify(["EVENT", id, ev]));
        ws.send(JSON.stringify(["EOSE", id]));
      } else if (type === "CLOSE") {
        subs.get(ws)?.delete(a);
      }
    });
    ws.on("close", () => subs.delete(ws));
  });
  return { wss, events, close: () => wss.close() };
}

/* global iina, setTimeout */

const { file, global, preferences, ws, console } = iina;
const clients = {};
const players = {};
let lastPlayerID = null;
const mediaExtensions = { mp4: true, mov: true, mkv: true, avi: true, m4v: true, webm: true, mp3: true, wav: true, aac: true, flac: true, m4a: true, aiff: true, ts: true, m2ts: true, mts: true, mpg: true, mpeg: true, ogg: true, opus: true, wmv: true, wma: true, flv: true, ape: true, alac: true, "3gp": true, "3g2": true, ogv: true };

function token() {
  let value = String(preferences.get("token") || "").trim();
  if (!value) {
    value = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    preferences.set("token", value);
    preferences.sync();
  }
  return value;
}

function send(connection, payload) {
  try { ws.sendText(connection, JSON.stringify(payload)); } catch (error) { console.warn(String(error)); }
}

function broadcast(payload) {
  Object.keys(clients).forEach((connection) => { if (clients[connection].authenticated) send(connection, payload); });
}

function library() {
  const folder = String(preferences.get("mediaFolder") || "").trim().replace(/\/$/, "");
  if (!folder) return { folder: "", files: [], error: null };
  try {
    const files = file.list(folder, { includeSubDir: preferences.get("scanSubfolders") !== false })
      .filter((entry) => !entry.isDir && mediaExtensions[String(entry.filename).split(".").pop().toLowerCase()] === true)
      .slice(0, 2000)
      .map((entry) => {
        const listed = String(entry.path || entry.filename || "");
        const path = listed.indexOf(`${folder}/`) === 0 ? listed : `${folder}/${listed.replace(/^\/+/, "")}`;
        return { label: path.slice(folder.length + 1), path };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    return { folder, files, error: null };
  } catch (error) { return { folder, files: [], error: String(error && error.message ? error.message : error) }; }
}

function playerList() {
  return Object.keys(players).map((id) => ({ id, label: players[id].label || `視窗 ${id}`, state: players[id].state }));
}

function publishPlayers() {
  broadcast({ type: "players", players: playerList() });
}

function forward(message, connection) {
  const args = message.args || {};
  let target = String(args.playerId || lastPlayerID || "");
  if (!target || !players[target]) {
    send(connection, { type: "error", requestId: message.requestId || null, error: { code: "no_player", message: "No target player window" } });
    return;
  }
  global.postMessage(target, "player-command", { command: message.command, args, requestId: message.requestId || null });
}

global.onMessage("player-state", (data, playerID) => {
  const id = String(playerID);
  players[id] = { label: String(data.label || ""), state: data.state || {} };
  lastPlayerID = id;
  broadcast({ type: "state", requestId: null, playerId: id, state: data.state || {} });
  publishPlayers();
});

global.onMessage("player-result", (data, playerID) => {
  const payload = { ...data, playerId: String(playerID) };
  if (data.state) players[String(playerID)] = { label: players[String(playerID)]?.label || "", state: data.state };
  broadcast(payload);
});

global.onMessage("player-closed", (_data, playerID) => {
  delete players[String(playerID)];
  if (lastPlayerID === String(playerID)) lastPlayerID = Object.keys(players).pop() || null;
  publishPlayers();
});

ws.onNewConnection((connection, info) => {
  clients[connection] = { authenticated: false };
  send(connection, { type: "hello", protocolVersion: 2, server: "iina-companion-remote", authenticationRequired: true, path: info.path });
});
ws.onConnectionStateUpdate((connection, state) => { if (state === "failed" || state === "cancelled") delete clients[connection]; });
ws.onMessage((connection, raw) => {
  let message;
  try { message = JSON.parse(raw.text()); } catch (_error) { return; }
  if (message.type === "auth") {
    clients[connection].authenticated = typeof message.token === "string" && message.token === token();
    send(connection, { type: "auth_result", requestId: message.requestId || null, ok: clients[connection].authenticated, protocolVersion: 2, state: players[lastPlayerID]?.state || null });
    if (clients[connection].authenticated) {
      send(connection, { type: "library", ...library() });
      send(connection, { type: "players", players: playerList() });
    }
    return;
  }
  if (!clients[connection]?.authenticated) return;
  if (message.type === "refresh_library") send(connection, { type: "library", requestId: message.requestId || null, ...library() });
  else if (message.type === "get_players") send(connection, { type: "players", requestId: message.requestId || null, players: playerList() });
  else if (message.type === "get_state") send(connection, { type: "state", requestId: message.requestId || null, playerId: lastPlayerID, state: players[lastPlayerID]?.state || null });
  else if (message.type === "ping") send(connection, { type: "pong", requestId: message.requestId || null });
  else if (message.type === "command" && message.command === "create_player") {
    const args = message.args || {};
    const label = String(args.label || `Player ${Date.now()}`);
    const id = global.createPlayerInstance({ label, disableWindowAnimation: true, disableUI: false, enablePlugins: false });
    setTimeout(() => global.postMessage(id, "player-command", { command: "open", args: { url: args.url, startFromBeginning: args.startFromBeginning === true }, requestId: message.requestId || null }), 300);
    setTimeout(() => global.postMessage(id, "player-command", { command: "set_end_behavior", args: { behavior: args.endBehavior || "hold" }, requestId: null }), 500);
    if (String(args.screen || "0") !== "0") setTimeout(() => global.postMessage(id, "player-command", { command: "fullscreen_on_screen", args: { screen: args.screen }, requestId: null }), 900);
  } else if (message.type === "command") forward(message, connection);
});

const configuredPort = Number(preferences.get("port"));
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536 ? configuredPort : 19190;
token();
ws.createServer({ port });
ws.startServer();

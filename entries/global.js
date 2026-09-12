/* global iina, setTimeout */
const { file, global, menu, preferences, standaloneWindow, utils, ws, console } = iina;
const clients = {}, players = {}, inbound = [], playerQueue = [], pendingSends = [];
const pendingSystemTasks = [];
let lastPlayerID = null, inboundActive = false, playerActive = false, listPending = false;
let controllerVisible = false, controllerCompact = false;
const extensions = { mp4:1,mov:1,mkv:1,avi:1,m4v:1,webm:1,mp3:1,wav:1,aac:1,flac:1,m4a:1,aiff:1,ts:1,m2ts:1,mts:1,mpg:1,mpeg:1,ogg:1,opus:1,wmv:1,wma:1,flv:1,ape:1,alac:1,"3gp":1,"3g2":1,ogv:1 };

function getToken() {
  let value = String(preferences.get("token") || "").trim();
  if (!value) { value = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`; preferences.set("token", value); preferences.sync(); }
  return value;
}
function send(connection, payload) {
  if (!clients[connection]) return;
  try {
    const promise = ws.sendText(connection, JSON.stringify(payload));
    // Keep the native-backed promise alive until Network.framework has certainly
    // completed. IINA 1.5 beta can otherwise release its JSValue on the WS queue.
    if (promise) {
      pendingSends.push(promise);
      setTimeout(() => { const index = pendingSends.indexOf(promise); if (index >= 0) pendingSends.splice(index, 1); }, 10000);
    }
  } catch (error) { console.warn(String(error)); }
}
function broadcast(payload) { Object.keys(clients).forEach((connection) => { if (clients[connection].authenticated) send(connection, payload); }); }
function retainSystemTask(task) {
  if (!task) return;
  pendingSystemTasks.push(task);
  setTimeout(() => { const index = pendingSystemTasks.indexOf(task); if (index >= 0) pendingSystemTasks.splice(index, 1); }, 5000);
}
function showController() {
  controllerVisible = true;
  // standaloneWindow.open() does not activate IINA while another macOS app is
  // in front. `open` activates IINA without requiring Apple Events permission.
  try { retainSystemTask(utils.exec("/usr/bin/open", ["-b", "com.colliderli.iina"])); } catch (error) { console.warn(String(error)); }
  standaloneWindow.open();
  updateController();
  // Open it again after activation so the controller, rather than a player
  // window, becomes the frontmost IINA window.
  setTimeout(() => { if (controllerVisible) { standaloneWindow.open(); updateController(); } }, 250);
}
function library() {
  const folder = String(preferences.get("mediaFolder") || "").trim().replace(/\/$/, "");
  if (!folder) return { folder:"", files:[], error:null };
  try {
    const files = file.list(folder, { includeSubDir: preferences.get("scanSubfolders") !== false }).filter((entry) => !entry.isDir && extensions[String(entry.filename).split(".").pop().toLowerCase()]).slice(0, 2000).map((entry) => {
      const listed = String(entry.path || entry.filename || "");
      const path = listed.indexOf(`${folder}/`) === 0 ? listed : `${folder}/${listed.replace(/^\/+/, "")}`;
      return { label:path.slice(folder.length + 1), path };
    }).sort((a,b) => a.label.localeCompare(b.label));
    return { folder, files, error:null };
  } catch (error) { return { folder, files:[], error:String(error && error.message ? error.message : error) }; }
}
function playerList() { return Object.keys(players).map((id) => ({ id, label:players[id].label || `視窗 ${id}`, state:players[id].state })); }
function updateController() { try { standaloneWindow.postMessage("snapshot", { players:playerList(), selectedPlayerId:lastPlayerID, library:library() }); } catch (_error) {} }
function publishList() { listPending = false; broadcast({ type:"players", players:playerList() }); updateController(); }
function scheduleList() { if (!listPending) { listPending = true; setTimeout(publishList, 100); } }
function forward(message, connection) {
  const args = message.args || {}, target = String(args.playerId || lastPlayerID || "");
  if (!target || !players[target]) { if (connection) send(connection, { type:"error", requestId:message.requestId || null, error:{ code:"no_player", message:"No target player window" } }); return; }
  global.postMessage(target, "player-command", { command:message.command, args, requestId:message.requestId || null });
}
function handle(connection, message) {
  if (!clients[connection]) return;
  if (message.type === "auth") {
    clients[connection].authenticated = typeof message.token === "string" && message.token === getToken();
    send(connection, { type:"auth_result", requestId:message.requestId || null, ok:clients[connection].authenticated, protocolVersion:3, state:players[lastPlayerID]?.state || null });
    if (clients[connection].authenticated) { send(connection, { type:"library", ...library() }); send(connection, { type:"players", players:playerList() }); }
    return;
  }
  if (!clients[connection].authenticated) return;
  if (message.type === "refresh_library") send(connection, { type:"library", requestId:message.requestId || null, ...library() });
  else if (message.type === "get_players") send(connection, { type:"players", requestId:message.requestId || null, players:playerList() });
  else if (message.type === "get_state") send(connection, { type:"state", requestId:message.requestId || null, playerId:lastPlayerID, state:players[lastPlayerID]?.state || null });
  else if (message.type === "ping") send(connection, { type:"pong", requestId:message.requestId || null });
  else if (message.type === "command" && message.command === "controller_visibility") {
    const operation = String((message.args || {}).operation || "toggle");
    const show = operation === "show" || (operation === "toggle" && !controllerVisible);
    if (show) showController();
    else { standaloneWindow.close(); controllerVisible = false; }
    send(connection, { type:"command_result", requestId:message.requestId || null, ok:true, controllerVisible, controllerCompact });
  }
  else if (message.type === "command" && message.command === "controller_mode") {
    const operation = String((message.args || {}).operation || "toggle");
    controllerCompact = operation === "compact" || (operation === "toggle" && !controllerCompact);
    standaloneWindow.setFrame(controllerCompact ? 470 : 1120, controllerCompact ? 317 : 760);
    standaloneWindow.postMessage("set-mode", { compact:controllerCompact });
    send(connection, { type:"command_result", requestId:message.requestId || null, ok:true, controllerVisible, controllerCompact });
  }
  else if (message.type === "command" && message.command === "select_player") {
    const id = String((message.args || {}).playerId || "");
    if (players[id]) { lastPlayerID = id; send(connection, { type:"command_result", requestId:message.requestId || null, ok:true, playerId:id, state:players[id].state }); updateController(); }
    else send(connection, { type:"error", requestId:message.requestId || null, error:{ code:"no_player", message:"No target player window" } });
  }
  else if (message.type === "command" && message.command === "create_player") {
    const args = message.args || {}, id = global.createPlayerInstance({ label:String(args.label || `Player ${Date.now()}`), disableWindowAnimation:true, disableUI:false, enablePlugins:false });
    setTimeout(() => global.postMessage(id, "player-command", { command:"open", args:{ url:args.url, startFromBeginning:args.startFromBeginning === true }, requestId:message.requestId || null }), 400);
    setTimeout(() => global.postMessage(id, "player-command", { command:"set_end_behavior", args:{ behavior:args.endBehavior || "hold" }, requestId:null }), 650);
    if (String(args.screen || "0") !== "0") setTimeout(() => global.postMessage(id, "player-command", { command:"fullscreen_on_screen", args:{ screen:args.screen }, requestId:null }), 1100);
  } else if (message.type === "command") forward(message, connection);
}
function drainInbound() { inboundActive = false; const item = inbound.shift(); if (item) handle(item.connection, item.message); if (inbound.length) { inboundActive = true; setTimeout(drainInbound, 10); } }
function queueInbound(connection, message) { inbound.push({ connection, message }); if (!inboundActive) { inboundActive = true; setTimeout(drainInbound, 0); } }
function drainPlayers() {
  playerActive = false; const item = playerQueue.shift();
  if (item) {
    const id = item.id, data = item.data || {};
    if (item.kind === "state") {
      const fresh = !players[id]; players[id] = { label:String(data.label || ""), state:data.state || {} }; if (!lastPlayerID || !players[lastPlayerID]) lastPlayerID = id;
      broadcast({ type:"state", requestId:null, playerId:id, state:data.state || {} });
      try { standaloneWindow.postMessage("player-state", { playerId:id, label:players[id].label, state:players[id].state }); } catch (_error) {}
      if (fresh) scheduleList();
    } else if (item.kind === "result") {
      if (data.state && players[id]) players[id].state = data.state;
      broadcast({ type:data.type || "command_result", requestId:data.requestId || null, ok:data.ok !== false, error:data.error, state:data.state, playerId:id });
      try { standaloneWindow.postMessage("command-result", { ...data, playerId:id }); } catch (_error) {}
    } else { delete players[id]; if (lastPlayerID === id) lastPlayerID = Object.keys(players).pop() || null; scheduleList(); }
  }
  if (playerQueue.length) { playerActive = true; setTimeout(drainPlayers, 10); }
}
function queuePlayer(kind, data, playerID) {
  const id = String(playerID);
  if (kind === "state") { for (let i = playerQueue.length - 1; i >= 0; i -= 1) if (playerQueue[i].kind === "state" && playerQueue[i].id === id) { playerQueue[i].data = data; return; } }
  playerQueue.push({ kind, data, id }); if (!playerActive) { playerActive = true; setTimeout(drainPlayers, 0); }
}
global.onMessage("player-state", (data,id) => queuePlayer("state",data,id));
global.onMessage("player-result", (data,id) => queuePlayer("result",data,id));
global.onMessage("player-closed", (data,id) => queuePlayer("closed",data,id));
ws.onNewConnection((connection,info) => { clients[connection] = { authenticated:false }; send(connection, { type:"hello", protocolVersion:3, server:"iina-companion-remote", authenticationRequired:true, path:info.path }); });
ws.onConnectionStateUpdate((connection,state) => { if (state === "failed" || state === "cancelled") delete clients[connection]; });
ws.onMessage((connection,raw) => { try { queueInbound(connection, JSON.parse(raw.text())); } catch (_error) {} });

standaloneWindow.loadFile("controller.html");
standaloneWindow.setProperty({ title:"IINA Remote Controller", resizable:true, hudWindow:true, fullSizeContentView:false, hideTitleBar:false });
standaloneWindow.setFrame(1120, 760);
standaloneWindow.onMessage("ready", () => { controllerVisible = true; updateController(); });
standaloneWindow.onMessage("refresh", updateController);
standaloneWindow.onMessage("controller-mode", (data) => { controllerCompact = data.compact === true; standaloneWindow.setFrame(controllerCompact ? 470 : 1120, controllerCompact ? 317 : 760); });
standaloneWindow.onMessage("controller-closed", () => { controllerVisible = false; });
standaloneWindow.onMessage("select-player", (data) => { const id = String(data.playerId || ""); if (players[id]) lastPlayerID = id; updateController(); });
standaloneWindow.onMessage("command", (data) => forward({ command:data.command, args:{ ...(data.args || {}), playerId:data.playerId || lastPlayerID }, requestId:`controller-${Date.now()}` }, null));
menu.addItem(menu.item("開啟 Remote Controller…", showController, { keyBinding:"Meta+Shift+R" }));

const configuredPort = Number(preferences.get("port"));
getToken(); ws.createServer({ port:Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536 ? configuredPort : 19190 }); ws.startServer();

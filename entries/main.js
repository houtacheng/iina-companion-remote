/* global iina, setInterval, setTimeout */

const { core, event, file, global, mpv, playlist, preferences, console } = iina;

let playbackFinished = false;
let seekToStartOnNextFile = false;
let endBehavior = "hold";
let commandQueue = [];
let commandQueueActive = false;
let lastPlaylistNavigation = 0;
let details = { audioTracks: [], subtitleTracks: [], playlistItems: [], chapters: [], screens: [], videoInfo: "" };

function randomToken() {
  let value = "";
  for (let index = 0; index < 6; index += 1) {
    value += Math.random().toString(36).slice(2);
  }
  return value.slice(0, 40);
}

function getToken() {
  let token = String(preferences.get("token") || "").trim();
  if (!token) {
    token = randomToken();
    preferences.set("token", token);
    preferences.sync();
  }
  return token;
}


const mediaExtensions = {
  "3g2": true, "3gp": true, "aac": true, "aiff": true, "alac": true,
  "ape": true, "avi": true, "flac": true, "flv": true, "m2ts": true,
  "m4a": true, "m4v": true, "mkv": true, "mov": true, "mp3": true,
  "mp4": true, "mpeg": true, "mpg": true, "mts": true, "ogg": true,
  "ogv": true, "opus": true, "ts": true, "wav": true, "webm": true,
  "wma": true, "wmv": true,
};

function mediaLibrary() {
  const folder = String(preferences.get("mediaFolder") || "").trim();
  if (!folder) return { folder: "", files: [], error: null };
  try {
    const entries = file.list(folder, { includeSubDir: preferences.get("scanSubfolders") !== false });
    const files = entries
      .filter((entry) => {
        if (entry.isDir) return false;
        const extension = String(entry.filename).split(".").pop().toLowerCase();
        return mediaExtensions[extension] === true;
      })
      .slice(0, 2000)
      .map((entry) => {
        // IINA's file.list() returns paths rooted at the folder passed to it
        // (for example "/movie.mp4"), not necessarily absolute filesystem paths.
        const listedPath = String(entry.path || entry.filename || "");
        const absolutePath = listedPath.indexOf(`${folder}/`) === 0
          ? listedPath
          : `${folder.replace(/\/$/, "")}/${listedPath.replace(/^\/+/, "")}`;
        return {
          label: absolutePath.slice(folder.replace(/\/$/, "").length + 1),
          path: absolutePath,
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    return { folder, files, error: null };
  } catch (error) {
    return { folder, files: [], error: String(error && error.message ? error.message : error) };
  }
}

function resolveOpenTarget(value) {
  const target = String(value || "").trim();
  const folder = String(preferences.get("mediaFolder") || "").trim().replace(/\/$/, "");
  if (!folder || !target.startsWith("/") || target.indexOf(`${folder}/`) === 0) return target;

  // Version 0.3.0 sent paths such as "/movie.mp4" to Companion. Keep existing
  // buttons working by matching that legacy value against the current library.
  const candidate = `${folder}/${target.replace(/^\/+/, "")}`;
  const knownFile = mediaLibrary().files.some((entry) => entry.path === candidate);
  return knownFile ? candidate : target;
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a finite number`);
  }
  return number;
}

function safeRead(read, fallback) {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function refreshDetails() {
  const audioTracks = safeRead(() => core.audio.tracks, []).map((track) => ({ id: track.id, label: track.formattedTitle || track.title || track.lang || `Audio ${track.id}`, language: track.lang || "", codec: track.codec || "" }));
  const subtitleTracks = safeRead(() => core.subtitle.tracks, []).map((track) => ({ id: track.id, label: track.formattedTitle || track.title || track.lang || `Subtitle ${track.id}`, language: track.lang || "", codec: track.codec || "" }));
  const videoTracks = safeRead(() => core.video.tracks, []);
  const video = videoTracks.find((track) => track.id === safeRead(() => core.video.id, null)) || videoTracks[0] || {};
  details = {
    audioTracks,
    subtitleTracks,
    playlistItems: safeRead(() => playlist.list(), []).map((item, index) => ({ id: index, label: item.title || String(item.filename || "").split("/").pop() || `項目 ${index + 1}`, filename: item.filename || "", isPlaying: item.isPlaying === true })),
    chapters: safeRead(() => core.getChapters(), []).map((item, index) => ({ id: index, title: item.title || `章節 ${index + 1}`, time: item.start || 0 })),
    screens: safeRead(() => core.window.screens, []).map((screen, index) => ({ id: index + 1, label: screen.name || `螢幕 ${index + 1}`, frame: screen.frame })),
    videoInfo: [video.demuxW && video.demuxH ? `${video.demuxW}×${video.demuxH}` : "", video.demuxFPS ? `${Number(video.demuxFPS).toFixed(2)} fps` : "", video.codec || ""].filter(Boolean).join(" · "),
  };
}

function currentState() {
  const position = safeRead(() => core.status.position, null);
  const duration = safeRead(() => core.status.duration, null);
  const paused = safeRead(() => core.status.paused, true);
  const idle = safeRead(() => core.status.idle, true);
  const playlistPosition = safeRead(() => mpv.getNumber("playlist-pos"), -1);
  const playlistCount = safeRead(() => mpv.getNumber("playlist-count"), 0);

  return {
    playback: idle ? "idle" : paused ? "paused" : "playing",
    paused,
    idle,
    position,
    duration,
    remaining:
      position !== null && duration !== null ? Math.max(0, duration - position) : null,
    remainingSeconds:
      playbackFinished ? 0 : position !== null && duration !== null ? Math.max(0, Math.ceil(duration - position)) : null,
    playbackFinished,
    progress:
      position !== null && duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : null,
    speed: safeRead(() => core.status.speed, 1),
    volume: safeRead(() => core.audio.volume, 0),
    muted: safeRead(() => core.audio.muted, false),
    title: safeRead(() => core.status.title, ""),
    url: safeRead(() => core.status.url, ""),
    fullscreen: safeRead(() => core.window.fullscreen, false),
    pip: safeRead(() => core.window.pip, false),
    ontop: safeRead(() => core.window.ontop, false),
    playlistPosition,
    playlistCount,
    chapter: safeRead(() => mpv.getNumber("chapter"), -1),
    chapterCount: safeRead(() => mpv.getNumber("chapters"), 0),
    audioTrack: safeRead(() => core.audio.id, null),
    videoTrack: safeRead(() => core.video.id, null),
    subtitleTrack: safeRead(() => core.subtitle.id, null),
    secondSubtitleTrack: safeRead(() => core.subtitle.secondID, null),
    audioDelay: safeRead(() => core.audio.delay, 0),
    subtitleDelay: safeRead(() => core.subtitle.delay, 0),
    subtitleVisible: safeRead(() => mpv.getFlag("sub-visibility"), true),
    loopFile: safeRead(() => mpv.getString("loop-file"), "no"),
    loopPlaylist: safeRead(() => mpv.getString("loop-playlist"), "no"),
    endBehavior,
    filename: safeRead(() => mpv.getString("filename"), ""),
    ...details,
    timestamp: Date.now(),
  };
}

function publishState() {
  global.postMessage("player-state", { label: global.getLabel(), state: currentState() });
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function enterFullscreenOnScreen(screenNumber) {
  const screens = core.window.screens;
  const index = Math.trunc(finiteNumber(screenNumber, "screen")) - 1;
  if (index < 0 || index >= screens.length) {
    throw new Error(`Screen ${index + 1} is not available; detected ${screens.length} screen(s)`);
  }
  const target = screens[index];
  const moveAndEnter = () => {
    const frame = target.frame;
    const inset = 40;
    core.window.frame = {
      x: frame.x + inset,
      y: frame.y + inset,
      width: Math.max(320, frame.width - inset * 2),
      height: Math.max(180, frame.height - inset * 2),
    };
    setTimeout(() => { core.window.fullscreen = true; }, 350);
  };
  if (core.window.fullscreen) {
    core.window.fullscreen = false;
    setTimeout(moveAndEnter, 900);
  } else {
    moveAndEnter();
  }
}

function runCommand(command, args) {
  switch (command) {
    case "play":
      core.resume();
      break;
    case "pause":
      core.pause();
      break;
    case "toggle_play_pause":
      core.status.paused ? core.resume() : core.pause();
      break;
    case "stop":
      core.stop();
      break;
    case "close_window":
      mpv.command("quit", []);
      break;
    case "frame_step":
      mpv.command("frame-step", []);
      break;
    case "frame_back_step":
      mpv.command("frame-back-step", []);
      break;
    case "screenshot":
      mpv.command("screenshot", [String(args.mode || "subtitles")]);
      break;
    case "seek_relative":
      core.seek(finiteNumber(args.seconds, "seconds"), args.exact === true);
      break;
    case "seek_absolute":
      core.seekTo(Math.max(0, finiteNumber(args.seconds, "seconds")));
      break;
    case "set_position_percent": {
      const percent = Math.max(0, Math.min(100, finiteNumber(args.percent, "percent")));
      const duration = core.status.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Current media has no known duration");
      }
      core.seekTo(duration * percent / 100);
      break;
    }
    case "set_volume":
      core.audio.volume = Math.max(0, Math.min(200, finiteNumber(args.volume, "volume")));
      break;
    case "set_mute":
      core.audio.muted = args.muted === true;
      break;
    case "toggle_mute":
      core.audio.muted = !core.audio.muted;
      break;
    case "set_speed":
      core.setSpeed(Math.max(0.01, Math.min(100, finiteNumber(args.speed, "speed"))));
      break;
    case "playlist_next":
      if (Date.now() - lastPlaylistNavigation < 300) break;
      lastPlaylistNavigation = Date.now();
      if (safeRead(() => mpv.getNumber("playlist-count"), 0) > 0 && safeRead(() => mpv.getNumber("playlist-pos"), -1) < safeRead(() => mpv.getNumber("playlist-count"), 0) - 1) playlist.playNext();
      break;
    case "playlist_previous":
      if (Date.now() - lastPlaylistNavigation < 300) break;
      lastPlaylistNavigation = Date.now();
      if (safeRead(() => mpv.getNumber("playlist-count"), 0) > 0 && safeRead(() => mpv.getNumber("playlist-pos"), -1) > 0) playlist.playPrevious();
      break;
    case "playlist_play":
      playlist.play(Math.max(0, Math.trunc(finiteNumber(args.index, "index")) - 1));
      break;
    case "playlist_add":
      playlist.add(requireString(args.url, "url"));
      break;
    case "playlist_remove":
      playlist.remove(Math.max(0, Math.trunc(finiteNumber(args.index, "index")) - 1));
      break;
    case "playlist_clear":
      mpv.command("playlist-clear", []);
      break;
    case "playlist_shuffle":
      mpv.command("playlist-shuffle", []);
      break;
    case "play_chapter":
      core.playChapter(Math.max(0, Math.trunc(finiteNumber(args.chapter, "chapter")) - 1));
      break;
    case "set_loop_file":
      mpv.set("loop-file", String(args.mode || "no"));
      break;
    case "set_loop_playlist":
      mpv.set("loop-playlist", String(args.mode || "no"));
      break;
    case "ab_loop":
      mpv.command("ab-loop", []);
      break;
    case "set_track": {
      const id = Math.trunc(finiteNumber(args.id, "id"));
      const type = String(args.trackType);
      if (type === "audio") core.audio.id = id;
      else if (type === "video") core.video.id = id;
      else if (type === "subtitle") core.subtitle.id = id;
      else if (type === "second_subtitle") core.subtitle.secondID = id;
      else throw new Error("Unknown track type");
      break;
    }
    case "set_delay": {
      const seconds = finiteNumber(args.seconds, "seconds");
      if (args.trackType === "audio") core.audio.delay = seconds;
      else if (args.trackType === "subtitle") core.subtitle.delay = seconds;
      else throw new Error("Unknown delay type");
      break;
    }
    case "set_subtitle_visibility":
      mpv.set("sub-visibility", args.enabled === true);
      break;
    case "set_rotation":
      mpv.set("video-rotate", Math.trunc(finiteNumber(args.degrees, "degrees")));
      break;
    case "set_aspect":
      mpv.set("video-aspect-override", requireString(args.aspect, "aspect"));
      break;
    case "set_video_adjustment": {
      const allowed = { brightness: true, contrast: true, gamma: true, saturation: true, hue: true };
      const property = String(args.property);
      if (!allowed[property]) throw new Error("Unsupported video adjustment");
      mpv.set(property, finiteNumber(args.value, "value"));
      break;
    }
    case "set_minimized":
      core.window.miniaturized = args.enabled === true;
      break;
    case "show_sidebar":
      core.window.sidebar = args.sidebar === "none" ? null : String(args.sidebar);
      break;
    case "show_osd":
      core.osd(requireString(args.message, "message"));
      break;
    case "set_auto_close_on_end":
      endBehavior = args.enabled === true ? "close" : "hold";
      break;
    case "set_end_behavior":
      endBehavior = ["hold", "close", "loop"].indexOf(String(args.behavior)) >= 0 ? String(args.behavior) : "hold";
      mpv.set("loop-file", endBehavior === "loop" ? "inf" : "no");
      break;
    case "set_fullscreen":
      core.window.fullscreen = args.enabled === true;
      break;
    case "toggle_fullscreen":
      core.window.fullscreen = !core.window.fullscreen;
      break;
    case "fullscreen_on_screen":
      enterFullscreenOnScreen(args.screen);
      break;
    case "set_pip":
      core.window.pip = args.enabled === true;
      break;
    case "set_ontop":
      core.window.ontop = args.enabled === true;
      break;
    case "open":
      seekToStartOnNextFile = args.startFromBeginning === true;
      core.open(resolveOpenTarget(requireString(args.url, "url")));
      break;
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

function handleCommand(message) {
  try {
    runCommand(message.command, message.args || {});
    setTimeout(() => global.postMessage("player-result", { type: "command_result", requestId: message.requestId || null, ok: true, state: currentState() }), 20);
  } catch (error) {
    console.warn(`Companion Remote command failed: ${error}`);
    setTimeout(() => global.postMessage("player-result", { type: "command_result", requestId: message.requestId || null, ok: false, error: String(error && error.message ? error.message : error), state: currentState() }), 20);
  }
}

function drainCommands() {
  commandQueueActive = false;
  const message = commandQueue.shift();
  if (message) handleCommand(message);
  if (commandQueue.length) { commandQueueActive = true; setTimeout(drainCommands, 25); }
}
global.onMessage("player-command", (message) => {
  commandQueue.push(message);
  if (!commandQueueActive) { commandQueueActive = true; setTimeout(drainCommands, 0); }
});
event.on("iina.window-did-close", () => global.postMessage("player-closed", {}));

[
  "mpv.pause.changed",
  "mpv.volume.changed",
  "mpv.mute.changed",
  "mpv.speed.changed",
  "mpv.end-file",
  "iina.window-fs.changed",
  "iina.pip.changed",
].forEach((eventName) => event.on(eventName, publishState));

event.on("iina.file-started", () => {
  playbackFinished = false;
  if (seekToStartOnNextFile) {
    seekToStartOnNextFile = false;
    setTimeout(() => {
      core.seekTo(0);
      core.resume();
    }, 100);
  }
  publishState();
});

event.on("iina.file-loaded", () => { refreshDetails(); publishState(); });
event.on("mpv.track-list.changed", () => { refreshDetails(); publishState(); });
event.on("mpv.playlist-count.changed", () => { refreshDetails(); publishState(); });

event.on("mpv.eof-reached.changed", () => {
  if (!safeRead(() => mpv.getFlag("eof-reached"), false)) return;
  playbackFinished = true;
  publishState();
  if (endBehavior === "close") {
    setTimeout(() => mpv.command("quit", []), 1000);
  }
});

const configuredInterval = Number(preferences.get("stateInterval"));
const stateInterval = Number.isFinite(configuredInterval)
  ? Math.max(250, Math.min(5000, configuredInterval))
  : 500;
setInterval(publishState, stateInterval);

refreshDetails();
publishState();

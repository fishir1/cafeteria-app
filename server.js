// ============================================================
// SERVER.JS — The engine
// Serves:
//   /                    → home menu
//   /cafeteria/screen    → cafeteria big screen
//   /cafeteria/control   → cafeteria phone controller
//   /prayer/screen       → prayer hall big screen
//   /prayer/control      → prayer hall phone controller
//   /ping                → keep-alive endpoint
//
// Two independent Socket.IO namespaces:
//   /          (default) → cafeteria
//   /prayer              → prayer hall
// ============================================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import path from "path";
import {
  createInitialState,
  createPrayerState,
} from "./state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Set up web server ----
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- Serve static assets ----
app.use(express.static(path.join(__dirname, "public")));

// ---- Friendly URLs ----
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});
app.get("/cafeteria/screen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "screen.html"));
});
app.get("/cafeteria/control", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "control.html"));
});
app.get("/prayer/screen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "prayer-screen.html"));
});
app.get("/prayer/control", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "prayer-control.html"));
});

// ============================================================
// CAFETERIA  (default namespace)
// ============================================================
let state = createInitialState();
let timerInterval = null;

function publicState() {
  const step = state.sequence[state.currentIndex];
  return {
    running: state.running,
    paused: state.paused,
    phase: step.phase,
    label: step.label,
    sublabel: step.sublabel,
    secondsLeft: state.secondsLeft,
    totalSeconds: step.seconds,
    color: step.color,
    currentIndex: state.currentIndex,
    totalSteps: state.sequence.length,
    loudMessageActive: state.loudMessageActive,
  };
}

function broadcast() {
  io.emit("state", publicState());
}

function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!state.running || state.paused) return;

    if (state.loudMessageActive && Date.now() >= state.loudMessageEndsAt) {
      state.loudMessageActive = false;
      broadcast();
    }

    const step = state.sequence[state.currentIndex];
    if (step.seconds === 0) return;

    state.secondsLeft -= 1;
    if (state.secondsLeft <= 0) {
      advanceStep();
    } else {
      broadcast();
    }
  }, 1000);
}

function advanceStep() {
  if (state.currentIndex < state.sequence.length - 1) {
    state.currentIndex += 1;
    const step = state.sequence[state.currentIndex];
    state.secondsLeft = step.seconds;
    io.emit("transition", { label: step.label });
    broadcast();
  } else {
    state.secondsLeft = 0;
    broadcast();
  }
}

io.on("connection", (socket) => {
  console.log("[cafeteria] Client connected:", socket.id);
  socket.emit("state", publicState());

  socket.on("command", (cmd) => {
    console.log("[cafeteria] Command:", cmd);

    switch (cmd) {
      case "start":
        state.running = true;
        state.paused = false;
        startTimerLoop();
        broadcast();
        break;
      case "pause":
        state.paused = !state.paused;
        broadcast();
        break;
      case "next":
        advanceStep();
        break;
      case "reset":
        state = createInitialState();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        broadcast();
        break;
      case "quiet":
        state.currentIndex = state.sequence.findIndex((s) => s.phase === 2);
        state.secondsLeft = state.sequence[state.currentIndex].seconds;
        state.running = true;
        state.paused = false;
        startTimerLoop();
        io.emit("transition", { label: "Quiet Time" });
        broadcast();
        break;
      case "exitPhase":
        state.currentIndex = state.sequence.findIndex((s) => s.phase === 3);
        state.secondsLeft = state.sequence[state.currentIndex].seconds;
        state.running = true;
        state.paused = false;
        startTimerLoop();
        io.emit("transition", { label: state.sequence[state.currentIndex].label });
        broadcast();
        break;
      case "loud":
        state.loudMessageActive = true;
        state.loudMessageEndsAt = Date.now() + 5000;
        io.emit("loud");
        broadcast();
        break;
    }
  });

  socket.on("disconnect", () => {
    console.log("[cafeteria] Client disconnected:", socket.id);
  });
});

// ============================================================
// PRAYER HALL  (namespace "/prayer")
// ============================================================
const prayer = createPrayerState();
prayer.freeMessage = null;
let prayerTimer = null;

function prayerPublicState() {
  const step = prayer.dismissSequence[prayer.dismissIndex];
  return {
    mode: prayer.mode,
    activeName: prayer.activeName,
    freeMessage: prayer.freeMessage,
    dismissIndex: prayer.dismissIndex,
    dismissTotal: prayer.dismissSequence.length,
    dismissLabel: step ? step.label : "",
    dismissSublabel: step ? step.sublabel : "",
    dismissSecondsLeft: prayer.dismissSecondsLeft,
    dismissTotalSeconds: step ? step.seconds : 0,
    dismissRunning: prayer.dismissRunning,
    dismissPaused: prayer.dismissPaused,
  };
}

const prayerNs = io.of("/prayer");

function prayerBroadcast() {
  prayerNs.emit("state", prayerPublicState());
}

function startPrayerTimer() {
  if (prayerTimer) clearInterval(prayerTimer);
  prayerTimer = setInterval(() => {
    if (prayer.mode !== "dismiss") return;
    if (!prayer.dismissRunning || prayer.dismissPaused) return;

    prayer.dismissSecondsLeft -= 1;

    if (prayer.dismissSecondsLeft <= 0) {
      if (prayer.dismissIndex < prayer.dismissSequence.length - 1) {
        prayer.dismissIndex += 1;
        prayer.dismissSecondsLeft =
          prayer.dismissSequence[prayer.dismissIndex].seconds;
        prayerNs.emit("dismissTransition", {
          label: prayer.dismissSequence[prayer.dismissIndex].label,
        });
        prayerBroadcast();
      } else {
        prayer.dismissRunning = false;
        prayer.mode = "end";
        prayerNs.emit("dismissEnd");
        prayerBroadcast();
      }
    } else {
      prayerBroadcast();
    }
  }, 1000);
}

prayerNs.on("connection", (socket) => {
  console.log("[prayer] Client connected:", socket.id);
  socket.emit("state", prayerPublicState());

  socket.on("sendName", (payload) => {
    const { role, name } = payload || {};
    if (!role || !name) return;

    prayer.mode = "names";
    prayer.activeName = { role, name };
    prayer.freeMessage = null;

    prayerNs.emit("nameArrived", { role, name });
    prayerBroadcast();
    console.log("[prayer] Name sent:", role, "=", name);
  });

  socket.on("sendMessage", (payload) => {
    const { text } = payload || {};
    if (!text) return;
    prayer.mode = "message";
    prayer.freeMessage = text;
    prayer.activeName = null;
    prayerNs.emit("nameArrived", { role: "message", name: text });
    prayerBroadcast();
    console.log("[prayer] Message sent:", text);
  });

  socket.on("dingSeven", () => {
    prayerNs.emit("dingSeven");
    console.log("[prayer] Ding ×7 requested");
  });

  socket.on("startDismiss", () => {
    prayer.mode = "dismiss";
    prayer.dismissIndex = 0;
    prayer.dismissSecondsLeft = prayer.dismissSequence[0].seconds;
    prayer.dismissRunning = true;
    prayer.dismissPaused = false;
    startPrayerTimer();
    prayerNs.emit("dismissTransition", {
      label: prayer.dismissSequence[0].label,
    });
    prayerBroadcast();
    console.log("[prayer] Dismissal started");
  });

  socket.on("nextClass", () => {
    if (prayer.mode !== "dismiss") return;
    if (prayer.dismissIndex < prayer.dismissSequence.length - 1) {
      prayer.dismissIndex += 1;
      prayer.dismissSecondsLeft =
        prayer.dismissSequence[prayer.dismissIndex].seconds;
      prayerNs.emit("dismissTransition", {
        label: prayer.dismissSequence[prayer.dismissIndex].label,
      });
      prayerBroadcast();
    } else {
      prayer.dismissRunning = false;
      prayer.mode = "end";
      prayerNs.emit("dismissEnd");
      prayerBroadcast();
    }
  });

  socket.on("pauseDismiss", () => {
    prayer.dismissPaused = !prayer.dismissPaused;
    prayerBroadcast();
  });

  socket.on("resetPrayer", () => {
    const fresh = createPrayerState();
    Object.assign(prayer, fresh);
    prayer.freeMessage = null;
    if (prayerTimer) clearInterval(prayerTimer);
    prayerTimer = null;
    prayerBroadcast();
    console.log("[prayer] Reset");
  });

  socket.on("disconnect", () => {
    console.log("[prayer] Client disconnected:", socket.id);
  });
});

// ---- Keep-alive endpoint ----
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// ---- Start the server ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cafeteria server running on http://localhost:${PORT}`);

  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    const PING_INTERVAL = 10 * 60 * 1000;
    setInterval(() => {
      fetch(`${renderUrl}/ping`)
        .then(() => console.log("Self-ping sent:", new Date().toISOString()))
        .catch((err) => console.log("Self-ping failed:", err.message));
    }, PING_INTERVAL);
    console.log("Self-ping enabled for:", renderUrl);
  }
});
// ============================================================
// SERVER.JS — The engine
// Runs the timer, accepts commands, broadcasts state to all
// connected screens (big screen + phone controller).
// ============================================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import path from "path";
import { createInitialState } from "./state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Set up web server ----
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- Serve the files in the "public" folder ----
app.use(express.static(path.join(__dirname, "public")));

// ---- The one and only state ----
let state = createInitialState();
let timerInterval = null;

// ---- Helper: what the clients need to see ----
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

// ---- Helper: broadcast current state ----
function broadcast() {
  io.emit("state", publicState());
}

// ---- Start / reset the timer loop ----
function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!state.running || state.paused) {
      return;
    }

    // Handle "voices too loud" auto-dismiss
    if (state.loudMessageActive && Date.now() >= state.loudMessageEndsAt) {
      state.loudMessageActive = false;
      broadcast();
    }

    const step = state.sequence[state.currentIndex];
    if (step.seconds === 0) {
      // End screen — no countdown
      return;
    }

    state.secondsLeft -= 1;

    if (state.secondsLeft <= 0) {
      advanceStep();
    } else {
      broadcast();
    }
  }, 1000);
}

// ---- Move to the next step in the sequence ----
function advanceStep() {
  if (state.currentIndex < state.sequence.length - 1) {
    state.currentIndex += 1;
    const step = state.sequence[state.currentIndex];
    state.secondsLeft = step.seconds;
    io.emit("transition", { label: step.label });
    broadcast();
  } else {
    // Already at the end
    state.secondsLeft = 0;
    broadcast();
  }
}

// ---- Socket.io: what to do when a client connects ----
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state immediately
  socket.emit("state", publicState());

  // ---- Commands from the phone ----
  socket.on("command", (cmd) => {
    console.log("Command received:", cmd);

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
        // Jump to quiet time (find index of phase 2 step)
        state.currentIndex = state.sequence.findIndex((s) => s.phase === 2);
        state.secondsLeft = state.sequence[state.currentIndex].seconds;
        state.running = true;
        state.paused = false;
        startTimerLoop();
        io.emit("transition", { label: "Quiet Time" });
        broadcast();
        break;

      case "exitPhase":
        // Jump to first class in phase 3
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
        state.loudMessageEndsAt = Date.now() + 5000; // 5 seconds
        io.emit("loud");
        broadcast();
        break;

      default:
        console.log("Unknown command:", cmd);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ---- Keep-alive endpoint (for uptime monitors + self-ping) ----
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// ---- Start the server ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cafeteria server running on http://localhost:${PORT}`);

  // ---- Self-ping: keep Render's free tier awake ----
  // Only runs when deployed (RENDER_EXTERNAL_URL is set by Render).
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    const PING_INTERVAL = 10 * 60 * 1000; // every 10 minutes
    setInterval(() => {
      fetch(`${renderUrl}/ping`)
        .then(() => console.log("Self-ping sent:", new Date().toISOString()))
        .catch((err) => console.log("Self-ping failed:", err.message));
    }, PING_INTERVAL);
    console.log("Self-ping enabled for:", renderUrl);
  }
});
// ============================================================
// SERVER.JS — The engine
// Serves:
//   /                    → home menu (choose cafeteria or prayer hall)
//   /cafeteria/screen    → cafeteria big screen
//   /cafeteria/control   → cafeteria phone controller
//   /prayer/screen       → prayer hall big screen (placeholder for now)
//   /prayer/control      → prayer hall phone controller (placeholder for now)
//   /ping                → keep-alive endpoint
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

// ---- Serve static assets (css, js, images) from /public ----
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

// These two are placeholders — they'll be replaced when we build the
// prayer hall pages. For now, they just redirect to home so nothing
// 404s when you tap the button on the home page.
app.get("/prayer/screen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.get("/prayer/control", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

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

    if (state.loudMessageActive && Date.now() >= state.loudMessageEndsAt) {
      state.loudMessageActive = false;
      broadcast();
    }

    const step = state.sequence[state.currentIndex];
    if (step.seconds === 0) {
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
    state.secondsLeft = 0;
    broadcast();
  }
}

// ---- Socket.io: what to do when a client connects ----
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("state", publicState());

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

      default:
        console.log("Unknown command:", cmd);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
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
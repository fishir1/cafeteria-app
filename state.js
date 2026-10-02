// ============================================================
// STATE.JS — The brain of the cafeteria app
// Holds all phase definitions, order, colors, and timers.
// ============================================================

// ---- COLORS per grade ----
// You can change these hex codes anytime to customize.
export const GRADE_COLORS = {
  "Grade 6": "#e63946", // red
  "Grade 5": "#2a9d8f", // teal
  "Grade 4": "#e9c46a", // yellow/gold
};

// ---- PHASE 1: Tray away, by grade, oldest first ----
export const PHASE1_GRADES = [
  { name: "Grade 6", seconds: 120 },
  { name: "Grade 5", seconds: 120 },
  { name: "Grade 4", seconds: 120 },
];

// ---- PHASE 2: Quiet time ----
export const PHASE2_QUIET = { name: "Quiet Time", seconds: 300 };

// ---- PHASE 3: Exit to prayer hall, by class, order m,h,s,f ----
export const PHASE3_CLASSES = [
  { name: "4M", seconds: 30, grade: "Grade 4" },
  { name: "4H", seconds: 30, grade: "Grade 4" },
  { name: "4S", seconds: 30, grade: "Grade 4" },
  { name: "4F", seconds: 30, grade: "Grade 4" },
  { name: "5M", seconds: 30, grade: "Grade 5" },
  { name: "5H", seconds: 30, grade: "Grade 5" },
  { name: "5S", seconds: 30, grade: "Grade 5" },
  { name: "6M", seconds: 30, grade: "Grade 6" },
  { name: "6H", seconds: 30, grade: "Grade 6" },
  { name: "6S", seconds: 30, grade: "Grade 6" },
  { name: "6F", seconds: 30, grade: "Grade 6" },
];

// ---- The full ordered sequence of steps ----
// Each step is what the screen shows next.
export function buildSequence() {
  const steps = [];

  // Phase 1: one step per grade
  for (const g of PHASE1_GRADES) {
    steps.push({
      phase: 1,
      label: g.name,
      sublabel: "Please put your trays away",
      seconds: g.seconds,
      color: GRADE_COLORS[g.name] || "#333333",
    });
  }

  // Phase 2: quiet time
  steps.push({
    phase: 2,
    label: "Quiet Time",
    sublabel: "Please settle down",
    seconds: PHASE2_QUIET.seconds,
    color: "#457b9d",
  });

  // Phase 3: one step per class
  for (const c of PHASE3_CLASSES) {
    steps.push({
      phase: 3,
      label: c.name,
      sublabel: "You may leave for the prayer hall",
      seconds: c.seconds,
      color: GRADE_COLORS[c.grade] || "#333333",
    });
  }

  // Phase 4: end screen (no timer)
  steps.push({
    phase: 4,
    label: "Thank You",
    sublabel: "Have a good day",
    seconds: 0,
    color: "#1d3557",
  });

  return steps;
}

// ---- Create a fresh state object ----
export function createInitialState() {
  return {
    sequence: buildSequence(),
    currentIndex: 0,
    secondsLeft: buildSequence()[0].seconds,
    paused: false,
    running: false, // set to true once start is pressed
    loudMessageActive: false,
    loudMessageEndsAt: null, // timestamp
  };
}
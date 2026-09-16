import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "counts.json");

function loadCounts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCounts(counts) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(counts));
  } catch {
    // Free-tier disks can be read-only or wiped on redeploy - the counter is
    // a fun stat, not critical data, so just keep serving from memory.
  }
}

let counts = loadCounts();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/count", (req, res) => {
  const day = String(req.query.day || "");
  res.json({ count: counts[day] || 0 });
});

// Increments at most once per (day, visitor) - the client enforces the
// "once per visitor" part via its own local storage flag before calling this.
app.post("/api/count", (req, res) => {
  const day = String(req.body?.day ?? "");
  if (!day) {
    res.status(400).json({ error: "day is required" });
    return;
  }
  counts[day] = (counts[day] || 0) + 1;
  saveCounts(counts);
  res.json({ count: counts[day] });
});

// Serves the client build made for Discord (base "/" instead of the GitHub
// Pages subpath, see the "build:render" script) so the Activity and its API
// calls share one origin, which Discord's sandboxed iframe requires.
const clientDist = path.join(__dirname, "../dist-discord");
app.use(express.static(clientDist));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(200).send("Riftdle counter API is running.");
  });
});

const port = process.env.PORT || 3300;
app.listen(port, () => {
  console.log(`Riftdle counter listening on port ${port}`);
});

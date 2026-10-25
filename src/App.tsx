import { useEffect, useMemo, useState } from "react";
import championsData from "./data/champions.json";
import { apiBase, setupDiscord } from "./discord";

interface Champion {
  id: string;
  name: string;
  title: string;
  icon: string;
  ddragonVersion: string;
  positions: string[];
  roles: string[];
  resource: string | null;
  attackType: string | null;
  faction: string | null;
  releaseYear: number | null;
}

type MatchLevel = "correct" | "partial" | "wrong";
type YearDirection = "higher" | "lower" | "same";
type Outcome = "playing" | "won" | "lost";

interface GuessResult {
  champion: Champion;
  position: MatchLevel;
  role: MatchLevel;
  resource: MatchLevel;
  attackType: MatchLevel;
  faction: MatchLevel;
  year: MatchLevel;
  yearDirection: YearDirection;
  win: boolean;
}

interface Stats {
  played: number;
  wins: number;
  streak: number;
  maxStreak: number;
  lastPlayedDay: number;
  lastWonDay: number;
}

const CHAMPIONS = championsData as Champion[];
const EPOCH_Y = 2026;
const EPOCH_M = 0;
const EPOCH_D = 1;
const DAY_MS = 86400000;
const MAX_GUESSES = 6;
const STATS_KEY = "riftdle-stats";
const GUESSES_KEY_PREFIX = "riftdle-guesses-";
const RANK_KEY_PREFIX = "riftdle-rank-";

// Strips apostrophes, spaces, and other punctuation so "kaisa" matches
// "Kai'Sa", "chogath" matches "Cho'Gath", "drmundo" matches "Dr. Mundo", etc.
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function titleCase(s: string): string {
  return s
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function iconUrl(c: Champion): string {
  // Self-hosted (see public/icons) rather than hotlinked from Riot's CDN -
  // Discord Activities sandbox cross-origin requests, so a third-party image
  // host would just render blank inside Discord.
  return `${import.meta.env.BASE_URL}icons/${c.icon}`;
}

function todayIndex(): number {
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const epochUTC = Date.UTC(EPOCH_Y, EPOCH_M, EPOCH_D);
  return Math.round((todayUTC - epochUTC) / DAY_MS);
}

function msUntilNextDay(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}

function getAnswer(): Champion {
  const idx = todayIndex() % CHAMPIONS.length;
  return CHAMPIONS[((idx % CHAMPIONS.length) + CHAMPIONS.length) % CHAMPIONS.length];
}

function compareArray(guess: string[], answer: string[]): MatchLevel {
  if (guess.length === 0 && answer.length === 0) return "correct";
  const answerSet = new Set(answer);
  const sameSet = guess.length === answer.length && guess.every((g) => answerSet.has(g));
  if (sameSet) return "correct";
  if (guess.some((g) => answerSet.has(g))) return "partial";
  return "wrong";
}

function compareScalar(a: string | null, b: string | null): MatchLevel {
  return a && b && a === b ? "correct" : "wrong";
}

function compareYear(guess: number | null, answer: number | null): { level: MatchLevel; dir: YearDirection } {
  if (guess == null || answer == null) return { level: "wrong", dir: "same" };
  if (guess === answer) return { level: "correct", dir: "same" };
  return { level: "wrong", dir: guess < answer ? "higher" : "lower" };
}

function evaluateGuess(guess: Champion, answer: Champion): GuessResult {
  const yearCmp = compareYear(guess.releaseYear, answer.releaseYear);
  return {
    champion: guess,
    position: compareArray(guess.positions, answer.positions),
    role: compareArray(guess.roles, answer.roles),
    resource: compareScalar(guess.resource, answer.resource),
    attackType: compareScalar(guess.attackType, answer.attackType),
    faction: compareScalar(guess.faction, answer.faction),
    year: yearCmp.level,
    yearDirection: yearCmp.dir,
    win: guess.id === answer.id,
  };
}

function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, lastPlayedDay: -1, lastWonDay: -1 };
}

function saveStats(s: Stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (e.g. sandboxed iframe) - keep playing without saving */
  }
}

function loadTodayGuesses(day: number, answer: Champion): GuessResult[] {
  try {
    const raw = localStorage.getItem(GUESSES_KEY_PREFIX + day);
    if (!raw) return [];
    const ids: string[] = JSON.parse(raw);
    return ids
      .map((id) => CHAMPIONS.find((c) => c.id === id))
      .filter((c): c is Champion => !!c)
      .map((c) => evaluateGuess(c, answer));
  } catch {
    return [];
  }
}

function saveTodayGuesses(day: number, guesses: GuessResult[]) {
  try {
    localStorage.setItem(GUESSES_KEY_PREFIX + day, JSON.stringify(guesses.map((g) => g.champion.id)));
  } catch {
    /* ignore */
  }
}

function getStoredRank(day: number): number | null {
  try {
    const v = localStorage.getItem(RANK_KEY_PREFIX + day);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

function storeRank(day: number, rank: number) {
  try {
    localStorage.setItem(RANK_KEY_PREFIX + day, String(rank));
  } catch {
    /* ignore */
  }
}

async function fetchCount(day: number): Promise<number | null> {
  try {
    const res = await fetch(`${apiBase()}/api/count?day=${day}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.count === "number" ? data.count : null;
  } catch {
    return null;
  }
}

async function postCount(day: number): Promise<number | null> {
  try {
    const res = await fetch(`${apiBase()}/api/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.count === "number" ? data.count : null;
  } catch {
    return null;
  }
}

export default function App() {
  const answer = useMemo(() => getAnswer(), []);
  const day = useMemo(() => todayIndex(), []);
  const [guesses, setGuesses] = useState<GuessResult[]>(() => loadTodayGuesses(day, answer));
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [stats, setStats] = useState<Stats>(() => loadStats());
  const [toast, setToast] = useState("");
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null>(() => getStoredRank(day));
  // Champion id of the guess that was just made, so only that row plays the
  // tile-flip reveal (rows restored from storage on load appear instantly).
  const [revealId, setRevealId] = useState<string | null>(null);

  const outcome: Outcome = guesses.some((g) => g.win) ? "won" : guesses.length >= MAX_GUESSES ? "lost" : "playing";
  const [modalOpen, setModalOpen] = useState(() => outcome !== "playing");
  const [statsOpen, setStatsOpen] = useState(false);
  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.champion.id)), [guesses]);

  useEffect(() => {
    setupDiscord();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (outcome !== "playing") setModalOpen(true);
  }, [outcome]);

  useEffect(() => {
    fetchCount(day).then((c) => {
      if (c != null) setLiveCount(c);
    });
  }, [day]);

  useEffect(() => {
    if (outcome === "playing") return;
    setStats((prev) => {
      if (prev.lastPlayedDay === day) return prev;
      const won = outcome === "won";
      const streak = won ? (prev.lastWonDay === day - 1 ? prev.streak + 1 : 1) : 0;
      const next: Stats = {
        played: prev.played + 1,
        wins: prev.wins + (won ? 1 : 0),
        streak,
        maxStreak: Math.max(prev.maxStreak, streak),
        lastPlayedDay: day,
        lastWonDay: won ? day : prev.lastWonDay,
      };
      saveStats(next);
      return next;
    });

    if (outcome === "won" && getStoredRank(day) == null) {
      postCount(day).then((c) => {
        if (c != null) {
          storeRank(day, c);
          setRank(c);
          setLiveCount(c);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, day]);

  const suggestions = useMemo(() => {
    const q = normalizeName(query);
    if (!q) return [];
    return CHAMPIONS.filter((c) => !guessedIds.has(c.id) && normalizeName(c.name).includes(q)).slice(0, 7);
  }, [query, guessedIds]);

  function submitGuess(champion: Champion) {
    if (outcome !== "playing" || guessedIds.has(champion.id)) return;
    const result = evaluateGuess(champion, answer);
    const next = [...guesses, result];
    setGuesses(next);
    setRevealId(champion.id);
    saveTodayGuesses(day, next);
    setQuery("");
    setShowSuggestions(false);
  }

  function handleSubmitTyped() {
    const q = normalizeName(query);
    const match = CHAMPIONS.find((c) => normalizeName(c.name) === q);
    if (match) submitGuess(match);
    else if (suggestions.length > 0) submitGuess(suggestions[0]);
  }

  function shareResult() {
    const icons: Record<MatchLevel, string> = { correct: "🟩", partial: "🟨", wrong: "⬛" };
    const lines = guesses.map((g) =>
      [g.position, g.role, g.resource, g.attackType, g.faction, g.year].map((m) => icons[m]).join("")
    );
    const scoreLabel = outcome === "won" ? `${guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
    const text = `Riftdle #${day} ${scoreLabel}\n${lines.join("\n")}`;
    navigator.clipboard
      .writeText(text)
      .then(() => setToast("Copied result to clipboard"))
      .catch(() => setToast("Couldn't copy — no clipboard access"));
  }

  const triesLeft = MAX_GUESSES - guesses.length;
  const newestFirst = [...guesses].reverse();

  return (
    <>
      <div
        className="bg-image"
        aria-hidden="true"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}bg/aatrox.jpg)` }}
      />
      <div className="bg-scrim" aria-hidden="true" />
      <div className="page">
        <header className="hero">
          <button className="icon-btn stats-btn" onClick={() => setStatsOpen(true)} aria-label="Stats">
            <BarsIcon />
          </button>
          <div className="crest" aria-hidden="true">
            ◈
          </div>
          <h1 className="logo">Riftdle</h1>
          <p className="tagline">Guess today's League of Legends champion</p>
        </header>

        <section className="frame prompt">
          <h2 className="prompt-title">
            {outcome === "won"
              ? "You found today's champion!"
              : outcome === "lost"
              ? "Out of tries for today"
              : "Guess today's champion!"}
          </h2>
          <p className="prompt-sub">
            {outcome === "playing"
              ? guesses.length === 0
                ? "Type any champion to begin."
                : "Each tile shows how close you are."
              : "A new champion arrives at midnight."}
          </p>

          <div className="pips" aria-label={`${triesLeft} tries left`}>
            {Array.from({ length: MAX_GUESSES }).map((_, i) => {
              const g = guesses[i];
              const cls = g ? (g.win ? "pip pip-win" : "pip pip-used") : "pip";
              return <span className={cls} key={i} />;
            })}
            <span className="pips-label">
              {outcome === "playing" ? `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left` : ""}
            </span>
          </div>

          <div className="guess-box">
            <div className="input-wrap">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitTyped();
                  if (e.key === "Escape") setShowSuggestions(false);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder={outcome !== "playing" ? "Come back tomorrow for a new champion" : "Type champion name…"}
                disabled={outcome !== "playing"}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="go-btn"
                onClick={handleSubmitTyped}
                disabled={outcome !== "playing" || !query.trim()}
                aria-label="Guess"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 2 L13 8 L4 14 Z" fill="currentColor" />
                </svg>
              </button>
              {showSuggestions && suggestions.length > 0 && outcome === "playing" && (
                <ul className="suggestions">
                  {suggestions.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => submitGuess(c)}>
                        <img src={iconUrl(c)} alt="" loading="lazy" />
                        <span>
                          <span className="sugg-name">{c.name}</span>
                          <span className="sugg-title">{c.title}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {liveCount != null && (
            <p className="live-count">
              <strong>{liveCount.toLocaleString()}</strong> summoners have found today's champion
            </p>
          )}
        </section>

        {guesses.length > 0 && (
          <div className="board-scroll">
            <div className="board">
              <div className="board-head">
                <div>Champion</div>
                <div>Position</div>
                <div>Class</div>
                <div>Resource</div>
                <div>Range</div>
                <div>Region</div>
                <div>Year</div>
              </div>
              {newestFirst.map((g) => {
                const animate = g.champion.id === revealId;
                return (
                  <div className={`board-row ${g.win ? "row-win" : ""}`} key={g.champion.id}>
                    <div className={`tile tile-champ ${animate ? "pop" : ""}`} title={g.champion.name}>
                      <img src={iconUrl(g.champion)} alt={g.champion.name} />
                      <span className="tile-name">{g.champion.name}</span>
                    </div>
                    <Cell level={g.position} step={1} animate={animate}>
                      {g.champion.positions.map(titleCase).join(", ") || "—"}
                    </Cell>
                    <Cell level={g.role} step={2} animate={animate}>
                      {g.champion.roles.map(titleCase).join(", ") || "—"}
                    </Cell>
                    <Cell level={g.resource} step={3} animate={animate}>
                      {g.champion.resource ? titleCase(g.champion.resource) : "—"}
                    </Cell>
                    <Cell level={g.attackType} step={4} animate={animate}>
                      {g.champion.attackType ? titleCase(g.champion.attackType) : "—"}
                    </Cell>
                    <Cell level={g.faction} step={5} animate={animate}>
                      {g.champion.faction ? titleCase(g.champion.faction) : "—"}
                    </Cell>
                    <Cell
                      level={g.year}
                      step={6}
                      animate={animate}
                      arrow={g.yearDirection !== "same" ? g.yearDirection : undefined}
                    >
                      {g.champion.releaseYear ?? "—"}
                    </Cell>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Legend />

        {toast && <div className="toast">{toast}</div>}

        {modalOpen && (
          <ResultModal
            outcome={outcome}
            answer={answer}
            guessCount={guesses.length}
            rank={rank}
            onClose={() => setModalOpen(false)}
            onShare={shareResult}
          />
        )}

        {statsOpen && <StatsModal stats={stats} onClose={() => setStatsOpen(false)} />}

        <footer className="foot">
          Champion data via Riot Games' public API. Not affiliated with or endorsed by Riot Games.
        </footer>
      </div>
    </>
  );
}

function Cell(props: {
  level: MatchLevel;
  step: number;
  animate: boolean;
  arrow?: "higher" | "lower";
  children: React.ReactNode;
}) {
  const cls = [
    "tile",
    `tile-${props.level}`,
    props.arrow ? `tile-arrow tile-${props.arrow}` : "",
    props.animate ? "flip" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={props.animate ? { animationDelay: `${props.step * 0.32}s` } : undefined}>
      <span className="tile-text">{props.children}</span>
    </div>
  );
}

function BarsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1" y="10" width="4" height="7" rx="0.5" fill="currentColor" />
      <rect x="7" y="6" width="4" height="11" rx="0.5" fill="currentColor" />
      <rect x="13" y="1" width="4" height="16" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function StatsModal({ stats, onClose }: { stats: Stats; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="frame modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal-title">Statistics</h2>
        <div className="stats-grid">
          <div className="stat-tile">
            <div className="stat-num">{stats.played}</div>
            <div className="stat-label">Played</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{stats.played ? Math.round((stats.wins / stats.played) * 100) : 0}%</div>
            <div className="stat-label">Win rate</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{stats.streak}</div>
            <div className="stat-label">Streak</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{stats.maxStreak}</div>
            <div className="stat-label">Best streak</div>
          </div>
        </div>
        <div className="modal-countdown">
          <div className="countdown-label">Next champion in</div>
          <Countdown />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <section className="frame legend">
      <div className="legend-title">Color indicators</div>
      <div className="legend-items">
        <div className="legend-item">
          <span className="swatch tile-correct" /> Correct
        </div>
        <div className="legend-item">
          <span className="swatch tile-partial" /> Partial
        </div>
        <div className="legend-item">
          <span className="swatch tile-wrong" /> Incorrect
        </div>
        <div className="legend-item">
          <span className="swatch tile-wrong tile-arrow tile-higher" /> Higher
        </div>
        <div className="legend-item">
          <span className="swatch tile-wrong tile-arrow tile-lower" /> Lower
        </div>
      </div>
    </section>
  );
}

function Countdown() {
  const [remaining, setRemaining] = useState(msUntilNextDay());
  useEffect(() => {
    const t = setInterval(() => setRemaining(msUntilNextDay()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="countdown-time">
      {pad(h)}:{pad(m)}:{pad(s)}
    </div>
  );
}

function ResultModal(props: {
  outcome: Outcome;
  answer: Champion;
  guessCount: number;
  rank: number | null;
  onClose: () => void;
  onShare: () => void;
}) {
  const { outcome, answer, guessCount, rank, onClose, onShare } = props;
  const won = outcome === "won";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`frame modal ${won ? "modal-win" : "modal-lose"}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal-title result-title">{won ? "Victory!" : "Defeat"}</h2>

        <div className="result-champ">
          <img src={iconUrl(answer)} alt="" />
        </div>
        <div className="modal-sub">{won ? "You guessed" : "The champion was"}</div>
        <div className="modal-name">{answer.name}</div>
        <div className="modal-champ-title">{answer.title}</div>

        {won && rank != null && (
          <p className="modal-line">
            You're the <strong>{ordinal(rank)}</strong> summoner to find today's champion
          </p>
        )}
        <p className="modal-line">
          Tries used: <strong>{guessCount}/{MAX_GUESSES}</strong>
        </p>

        <button className="gold-btn wide" onClick={onShare}>
          Share result
        </button>

        <div className="modal-countdown">
          <div className="countdown-label">Next champion in</div>
          <Countdown />
        </div>
      </div>
    </div>
  );
}

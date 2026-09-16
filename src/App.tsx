import { useEffect, useMemo, useRef, useState } from "react";
import championsData from "./data/champions.json";

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
  lastWonDay: number;
}

const CHAMPIONS = championsData as Champion[];
const EPOCH_Y = 2026;
const EPOCH_M = 0;
const EPOCH_D = 1;
const DAY_MS = 86400000;
const STATS_KEY = "riftdle-stats";
const GUESSES_KEY_PREFIX = "riftdle-guesses-";

function titleCase(s: string): string {
  return s
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconUrl(c: Champion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${c.ddragonVersion}/img/champion/${c.icon}`;
}

function todayIndex(): number {
  // Uses UTC-normalized midnights for both ends of the subtraction so a
  // daylight-saving transition between the epoch and today can't shift the
  // result by an hour and silently knock the day count off by one.
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const epochUTC = Date.UTC(EPOCH_Y, EPOCH_M, EPOCH_D);
  return Math.round((todayUTC - epochUTC) / DAY_MS);
}

function getAnswer(): Champion {
  const idx = todayIndex() % CHAMPIONS.length;
  return CHAMPIONS[((idx % CHAMPIONS.length) + CHAMPIONS.length) % CHAMPIONS.length];
}

function compareArray(guess: string[], answer: string[]): MatchLevel {
  if (guess.length === 0 && answer.length === 0) return "correct";
  const answerSet = new Set(answer);
  const guessSet = new Set(guess);
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
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, lastWonDay: -1 };
}

function saveStats(s: Stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(s));
}

function loadTodayGuesses(day: number, answerId: string): GuessResult[] {
  try {
    const raw = localStorage.getItem(GUESSES_KEY_PREFIX + day);
    if (!raw) return [];
    const ids: string[] = JSON.parse(raw);
    const answer = CHAMPIONS.find((c) => c.id === answerId);
    if (!answer) return [];
    return ids
      .map((id) => CHAMPIONS.find((c) => c.id === id))
      .filter((c): c is Champion => !!c)
      .map((c) => evaluateGuess(c, answer));
  } catch {
    return [];
  }
}

function saveTodayGuesses(day: number, guesses: GuessResult[]) {
  localStorage.setItem(GUESSES_KEY_PREFIX + day, JSON.stringify(guesses.map((g) => g.champion.id)));
}

export default function App() {
  const answer = useMemo(() => getAnswer(), []);
  const day = useMemo(() => todayIndex(), []);
  const [guesses, setGuesses] = useState<GuessResult[]>(() => loadTodayGuesses(day, answer.id));
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [stats, setStats] = useState<Stats>(() => loadStats());
  const [toast, setToast] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const won = guesses.some((g) => g.win);
  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.champion.id)), [guesses]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!won) return;
    setStats((prev) => {
      if (prev.lastWonDay === day) return prev;
      const streak = prev.lastWonDay === day - 1 ? prev.streak + 1 : 1;
      const next: Stats = {
        played: prev.played + 1,
        wins: prev.wins + 1,
        streak,
        maxStreak: Math.max(prev.maxStreak, streak),
        lastWonDay: day,
      };
      saveStats(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [won, day]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return CHAMPIONS.filter((c) => !guessedIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 7);
  }, [query, guessedIds]);

  function submitGuess(champion: Champion) {
    if (won || guessedIds.has(champion.id)) return;
    const result = evaluateGuess(champion, answer);
    const next = [result, ...guesses];
    setGuesses(next);
    saveTodayGuesses(day, next);
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function handleSubmitTyped() {
    const q = query.trim().toLowerCase();
    const match = CHAMPIONS.find((c) => c.name.toLowerCase() === q);
    if (match) {
      submitGuess(match);
    } else if (suggestions.length > 0) {
      submitGuess(suggestions[0]);
    }
  }

  function shareResult() {
    const rows = [...guesses].reverse();
    const icons: Record<MatchLevel, string> = { correct: "🟩", partial: "🟨", wrong: "⬛" };
    const lines = rows.map((g) =>
      [g.position, g.role, g.resource, g.attackType, g.faction, g.year].map((m) => icons[m]).join("")
    );
    const text = `Riftdle #${day} ${won ? guesses.length : "X"}/∞\n${lines.join("\n")}`;
    navigator.clipboard
      .writeText(text)
      .then(() => setToast("Copied result to clipboard"))
      .catch(() => setToast("Couldn't copy — no clipboard access"));
  }

  return (
    <div className="page">
      <div className="scanlines" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          RIFTDLE
        </div>
        <div className="stats-strip">
          <span>
            <strong>{stats.wins}</strong> WON
          </span>
          <span>
            <strong>{stats.streak}</strong> STREAK
          </span>
          <span>
            <strong>{stats.maxStreak}</strong> BEST
          </span>
        </div>
      </header>

      <p className="subhead">Guess the League of Legends champion. One per day. Unlimited tries.</p>

      <div className="guess-box">
        <div className="input-wrap">
          <input
            ref={inputRef}
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
            placeholder={won ? "Solved — nice work" : "Type a champion name…"}
            disabled={won}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="go-btn" onClick={handleSubmitTyped} disabled={won || !query.trim()}>
            GUESS
          </button>
          {showSuggestions && suggestions.length > 0 && !won && (
            <ul className="suggestions">
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button onClick={() => submitGuess(c)}>
                    <img src={iconUrl(c)} alt="" loading="lazy" />
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {won && (
        <div className="win-banner">
          <div>
            <strong>{answer.name}</strong>, {answer.title} — solved in {guesses.length}{" "}
            {guesses.length === 1 ? "guess" : "guesses"}.
          </div>
          <button className="share-btn" onClick={shareResult}>
            SHARE RESULT
          </button>
        </div>
      )}

      {guesses.length > 0 && (
        <div className="grid-scroll">
          <div className="grid-header">
            <div className="col-champ">CHAMPION</div>
            <div>POSITION</div>
            <div>CLASS</div>
            <div>RESOURCE</div>
            <div>RANGE</div>
            <div>REGION</div>
            <div>YEAR</div>
          </div>
          {guesses.map((g) => (
            <div className="grid-row" key={g.champion.id}>
              <div className="col-champ champ-cell">
                <img src={iconUrl(g.champion)} alt="" />
                <span>{g.champion.name}</span>
              </div>
              <Cell level={g.position}>{g.champion.positions.map(titleCase).join(", ") || "—"}</Cell>
              <Cell level={g.role}>{g.champion.roles.map(titleCase).join(", ") || "—"}</Cell>
              <Cell level={g.resource}>{g.champion.resource ? titleCase(g.champion.resource) : "—"}</Cell>
              <Cell level={g.attackType}>{g.champion.attackType ? titleCase(g.champion.attackType) : "—"}</Cell>
              <Cell level={g.faction}>{g.champion.faction ? titleCase(g.champion.faction) : "—"}</Cell>
              <Cell level={g.year}>
                {g.champion.releaseYear ?? "—"}
                {g.yearDirection === "higher" && <span className="arrow"> ▲</span>}
                {g.yearDirection === "lower" && <span className="arrow"> ▼</span>}
              </Cell>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <footer className="foot">
        Champion data via Riot Games' public API. Not affiliated with or endorsed by Riot Games.
      </footer>
    </div>
  );
}

function Cell(props: { level: MatchLevel; children: React.ReactNode }) {
  return <div className={`cell cell-${props.level}`}>{props.children}</div>;
}

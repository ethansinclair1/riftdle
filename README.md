# Riftdle

Wordle, but you're guessing a League of Legends champion. One a day, unlimited guesses, type
a name and it tells you how close you are on position, class, resource, range, region, and
release year — green means match, orange means partial overlap (for the multi-value ones),
grey means nope.

Champion data pulled from Riot's public API (via Meraki Analytics' cached feed) at build time,
baked into the app - no backend, no database, just a static site.

## Running it

```bash
npm install
npm run dev
```

opens on `localhost:5173`.

## Data

`src/data/champions.json` was generated once from `cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json`,
trimmed down to just what the game needs (name, icon, position, class roles, resource, attack
type, region, release year). To refresh it for new champions, re-fetch that URL and re-run the
same extraction.

## Deploying

Pushes to `main` auto-deploy to GitHub Pages via `.github/workflows/deploy.yml`. No server,
no environment variables, no separate build target - it's just a static site.

## The daily puzzle

The answer is picked deterministically from the day count since a fixed epoch date, modulo the
champion list length - same champion for everyone, all day, changes at local midnight. It isn't
synced with loldle.net's actual daily answer (there's no public way to read that), so the two
won't necessarily agree on any given day - this is its own independent puzzle using the same
kind of real champion data.

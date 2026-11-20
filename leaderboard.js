import { gameCatalog } from "./game-catalog.js";

const search = document.getElementById("game-search");
const playerSearch = document.getElementById("player-search");
const searchableGames = gameCatalog.map(name => ({ name }));
const results = document.getElementById("game-results");
const board = document.getElementById("leaderboard");
const status = document.getElementById("search-status");
const playerResults = document.getElementById("player-results");
const playerStatus = document.getElementById("player-search-status");
const loadStatus = document.getElementById("leaderboard-load-status");
const retryButton = document.getElementById("leaderboard-retry");
let leaderboardScores = {};
let selectedGameName = "";
let scoresLoaded = false;
let scoresLoading = false;

search.disabled = true;
playerSearch.disabled = true;

function selectGame(game) {
  selectedGameName = game.name;
  board.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = game.name;
  board.append(heading);
  const entries = leaderboardScores[game.name] || [];
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No scores have been added for this game yet.";
    board.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th scope=\"col\">Rank</th><th scope=\"col\">Name</th><th scope=\"col\">Score</th></tr></thead>";
  const tbody = document.createElement("tbody");
  [...entries].sort((a, b) => Number(b.score) - Number(a.score)).forEach((entry, index) => {
    const row = document.createElement("tr");
    const rank = document.createElement("td"); rank.textContent = String(index + 1);
    const name = document.createElement("td"); name.textContent = entry.name;
    const score = document.createElement("td"); score.textContent = String(entry.score);
    row.append(rank, name, score); tbody.append(row);
  });
  table.append(tbody); board.append(table);
}

search.addEventListener("input", () => {
  const query = search.value.trim().toLocaleLowerCase();
  results.replaceChildren();
  board.replaceChildren();
  if (!query) {
    status.textContent = "Search for a game to see matching games.";
    return;
  }
  const matches = searchableGames.filter(game => game.name.toLocaleLowerCase().includes(query));
  status.textContent = matches.length ? `${matches.length} game${matches.length === 1 ? "" : "s"} found. Choose one to view its leaderboard.` : "No games found. Try another name.";
  matches.forEach(game => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-option";
    button.textContent = game.name;
    button.addEventListener("click", () => {
      results.querySelectorAll(".game-option").forEach(option => option.removeAttribute("aria-current"));
      button.setAttribute("aria-current", "true");
      selectGame(game);
    });
    results.append(button);
  });
});

function searchPlayers() {
  const query = playerSearch.value.trim().toLocaleLowerCase();
  playerResults.replaceChildren();
  if (!query) {
    playerStatus.textContent = "Search by player name to find their scores.";
    return;
  }

  const matches = Object.entries(leaderboardScores)
    .flatMap(([game, entries]) => [...entries]
      .sort((a, b) => Number(b.score) - Number(a.score))
      .map((entry, index) => ({ game, entry, rank: index + 1 })))
    .filter(({ entry }) => String(entry.name).toLocaleLowerCase().includes(query))
    .sort((a, b) => a.game.localeCompare(b.game) || a.rank - b.rank);

  if (!matches.length) {
    playerStatus.textContent = "No approved scores found for that name.";
    return;
  }

  playerStatus.textContent = `${matches.length} score${matches.length === 1 ? "" : "s"} found.`;
  const heading = document.createElement("h2");
  heading.textContent = "Matching player scores";
  playerResults.append(heading);
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th scope=\"col\">Game</th><th scope=\"col\">Rank</th><th scope=\"col\">Name</th><th scope=\"col\">Score</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const { game, entry, rank } of matches) {
    const row = document.createElement("tr");
    for (const value of [game, String(rank), entry.name, String(entry.score)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  playerResults.append(table);
}

playerSearch.addEventListener("input", searchPlayers);

async function loadScores() {
  if (scoresLoading) return;
  scoresLoading = true;
  retryButton.hidden = true;
  try {
    const response = await fetch("/api/leaderboard", { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.scores)) throw new Error(data.error || "Could not load approved scores.");

    const updatedScores = {};
    for (const score of data.scores) {
      if (!gameCatalog.includes(score.game) || typeof score.name !== "string" || !Number.isSafeInteger(Number(score.score))) continue;
      (updatedScores[score.game] ??= []).push({ name: score.name, score: Number(score.score) });
    }
    leaderboardScores = updatedScores;
    scoresLoaded = true;
    search.disabled = false;
    playerSearch.disabled = false;
    loadStatus.textContent = "Scores are live from D1 and refresh about once a minute.";
    if (selectedGameName) selectGame({ name: selectedGameName });
    if (playerSearch.value.trim()) searchPlayers();
  } catch {
    if (scoresLoaded) {
      loadStatus.textContent = "Could not refresh scores. Showing the last loaded results.";
    } else {
      loadStatus.textContent = "Could not load scores from D1. Check the connection and try again.";
      retryButton.hidden = false;
    }
  } finally {
    scoresLoading = false;
  }
}

retryButton.addEventListener("click", loadScores);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && scoresLoaded) loadScores();
});
window.setInterval(() => {
  if (document.visibilityState === "visible" && scoresLoaded) loadScores();
}, 60_000);
loadScores();

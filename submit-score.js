import { gameCatalog } from "./game-catalog.js";

const form = document.getElementById("score-form");
const gameSelect = document.getElementById("submit-game");
const status = document.getElementById("submit-status");

for (const game of gameCatalog) {
  const option = document.createElement("option");
  option.value = game;
  option.textContent = game;
  gameSelect.append(option);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const image = document.getElementById("submit-image").files[0];
  if (image && image.size > 5 * 1024 * 1024) {
    status.textContent = "Choose an image smaller than 5 MB.";
    return;
  }
  button.disabled = true;
  status.textContent = "Uploading your score and screenshot...";
  try {
    const response = await fetch("/api/score-submissions", {
      method: "POST",
      body: new FormData(form)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not send your score.");
    form.reset();
    status.textContent = "Score and screenshot submitted. They will be reviewed before the score appears on the leaderboard.";
  } catch (error) {
    status.textContent = error.message || "Could not send your score. Please try again later.";
  } finally {
    button.disabled = false;
  }
});

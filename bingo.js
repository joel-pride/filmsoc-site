// Bingo Night (bingo.html): each visitor generates a personal 3×3 sheet that
// is saved in localStorage, so refreshing — or re-rolling behind the
// committee's back — can't change it. Crossed-off squares are saved with it.

const BINGO_STORAGE_KEY = "filmsocBingoSheet";

// Saved sheets store indexes into this list, so it must stay append-only:
// adding new squares is fine, but removing or reordering breaks old sheets.
const BINGO_SQUARES = [
  "with the same favourite actor as you",
  "with the same favourite director as you",
  "with the same film in their top 4",
  "who hates a film in your top 4",
  "who has never seen a film in your top 4",
  "who has seen more than 150 films this year",
  "with a Nolan film in their top 4",
  "with a 2020s film in their top 4",
  "with a film from before 1980 in their top 4",
  "with an animated film in their top 4",
  "who has rated a film under 3★ average a full 5★",
  "who has seen every Star Wars film",
  "who has seen a film in 70mm IMAX",
  "with an A24 film in their top 4",
  "with a Best Picture winner in their top 4",
  "with a non-English language film in their top 4",
  "whose favourite actor has never won an Oscar",
  "whose favourite director has never won an Oscar",
  "who has never seen a Marvel film",
  "who can name 5 Best Picture winners",
  "who has been to the cinema more than 10 times this year",
  "whose favourite genre is horror",
];

// Every way to complete a line on a 3×3 grid.
const BINGO_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const bingoIntro = document.getElementById("bingoIntro");
const bingoBoard = document.getElementById("bingoBoard");
const bingoGrid = document.getElementById("bingoGrid");
const generateBtn = document.getElementById("generateBtn");
const resetBtn = document.getElementById("resetBtn");
const bingoWin = document.getElementById("bingoWin");

function loadSheet() {
  try {
    const sheet = JSON.parse(localStorage.getItem(BINGO_STORAGE_KEY));
    const valid = sheet
      && Array.isArray(sheet.cells) && sheet.cells.length === 9
      && Array.isArray(sheet.marks) && sheet.marks.length === 9
      && sheet.cells.every((i) => Number.isInteger(i) && i >= 0 && i < BINGO_SQUARES.length);
    return valid ? sheet : null;
  } catch {
    return null;
  }
}

function saveSheet(sheet) {
  localStorage.setItem(BINGO_STORAGE_KEY, JSON.stringify(sheet));
}

// Fisher–Yates over the square indexes; the first nine become the sheet.
function generateCells() {
  const pool = BINGO_SQUARES.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 9);
}

function winningLines(marks) {
  return BINGO_LINES.filter((line) => line.every((i) => marks[i]));
}

function paintWins(sheet) {
  const cells = [...bingoGrid.children];
  cells.forEach((cell) => cell.classList.remove("win"));
  const wins = winningLines(sheet.marks);
  wins.forEach((line) => line.forEach((i) => cells[i].classList.add("win")));
  bingoWin.hidden = wins.length === 0;
}

function renderSheet(sheet) {
  bingoGrid.replaceChildren();
  sheet.cells.forEach((squareIndex, i) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "bingo-cell";
    cell.setAttribute("aria-pressed", String(sheet.marks[i]));
    const prefix = document.createElement("span");
    prefix.className = "bingo-cell-prefix";
    prefix.textContent = "Find someone";
    const text = document.createElement("span");
    text.className = "bingo-cell-text";
    text.textContent = BINGO_SQUARES[squareIndex];
    cell.append(prefix, text);
    if (sheet.marks[i]) cell.classList.add("marked");
    cell.addEventListener("click", () => {
      sheet.marks[i] = !sheet.marks[i];
      cell.classList.toggle("marked", sheet.marks[i]);
      cell.setAttribute("aria-pressed", String(sheet.marks[i]));
      saveSheet(sheet);
      paintWins(sheet);
    });
    bingoGrid.appendChild(cell);
  });
  paintWins(sheet);
}

function showIntro() {
  bingoIntro.hidden = false;
  bingoBoard.hidden = true;
}

function showBoard(sheet) {
  bingoIntro.hidden = true;
  bingoBoard.hidden = false;
  renderSheet(sheet);
}

generateBtn.addEventListener("click", () => {
  const sheet = { cells: generateCells(), marks: Array(9).fill(false) };
  saveSheet(sheet);
  showBoard(sheet);
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Start a new sheet? Your current squares and crosses will be lost.")) return;
  localStorage.removeItem(BINGO_STORAGE_KEY);
  showIntro();
});

// A saved sheet takes priority: refreshing must never hand out a new one.
const savedSheet = loadSheet();
if (savedSheet) showBoard(savedSheet);
else showIntro();

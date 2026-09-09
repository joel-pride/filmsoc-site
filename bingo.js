// Bingo Night (bingo.html): each visitor generates a personal 3×3 sheet that
// is saved in localStorage, so refreshing — or re-rolling behind the
// committee's back — can't change it. Crossed-off squares are saved with it.

const BINGO_STORAGE_KEY = "filmsocBingoSheet";

// Saved sheets store indexes into this list, so it must stay append-only:
// adding new squares is fine, but removing or reordering breaks old sheets.
const BINGO_SQUARES = [
  "Same favourite actor as you",
  "Same favourite director as you",
  "Same film in their top 4",
  "Hates a film in your top 4",
  "Never seen a film in your top 4",
  "Seen more than 150 films this year",
  "Nolan film in their top 4",
  "2020s film in their top 4",
  "Film from before 1980 in their top 4",
  "Animated film in their top 4",
  "Seen every Star Wars film",
  "Seen a film in 70mm IMAX",
  "A24 film in their top 4",
  "Best Picture winner in their top 4",
  "Non-English language film in their top 4",
  "Favourite actor has never won an Oscar",
  "Favourite director has never won an Oscar",
  "Never seen a Marvel film",
  "Name 5 Best Picture winners",
  "Been to the cinema more than 10 times this year",
  "Favourite genre is horror",
];

// Bingo is a full house: every square on the sheet crossed off.
function isFullHouse(marks) {
  return marks.every(Boolean);
}

const bingoIntro = document.getElementById("bingoIntro");
const bingoBoard = document.getElementById("bingoBoard");
const bingoGrid = document.getElementById("bingoGrid");
const generateBtn = document.getElementById("generateBtn");
const resetBtn = document.getElementById("resetBtn");
const bingoWin = document.getElementById("bingoWin");
const modalBackdrop = document.getElementById("bingoModalBackdrop");
const modalSquare = document.getElementById("bingoModalSquare");
const nameInput = document.getElementById("bingoNameInput");
const nameCancelBtn = document.getElementById("bingoNameCancel");
const nameSaveBtn = document.getElementById("bingoNameSave");

function loadSheet() {
  try {
    const sheet = JSON.parse(localStorage.getItem(BINGO_STORAGE_KEY));
    const valid = sheet
      && Array.isArray(sheet.cells) && sheet.cells.length === 9
      && Array.isArray(sheet.marks) && sheet.marks.length === 9
      && sheet.cells.every((i) => Number.isInteger(i) && i >= 0 && i < BINGO_SQUARES.length);
    if (!valid) return null;
    // Sheets saved before names were recorded get blank name entries.
    if (!Array.isArray(sheet.names)) sheet.names = Array(9).fill("");
    return sheet;
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

function paintWins(sheet) {
  const won = isFullHouse(sheet.marks);
  [...bingoGrid.children].forEach((cell) => cell.classList.toggle("win", won));
  bingoWin.hidden = !won;
}

// Refreshes one square's cross-off state and name without rebuilding the
// grid (a full re-render would replay the deal-in animation).
function paintCell(sheet, i) {
  const cell = bingoGrid.children[i];
  cell.classList.toggle("marked", sheet.marks[i]);
  cell.setAttribute("aria-pressed", String(sheet.marks[i]));
  let name = cell.querySelector(".bingo-cell-name");
  if (sheet.names[i]) {
    if (!name) {
      name = document.createElement("span");
      name.className = "bingo-cell-name";
      cell.appendChild(name);
    }
    name.textContent = sheet.names[i];
  } else if (name) {
    name.remove();
  }
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
    cell.addEventListener("click", () => {
      if (sheet.marks[i]) unmarkSquare(sheet, i);
      else openNameModal(sheet, i);
    });
    bingoGrid.appendChild(cell);
    paintCell(sheet, i);
  });
  paintWins(sheet);
}

/* ── Name entry dialog ─────────────────────────────── */

let activeCell = null; // { sheet, i } of the square the dialog is editing

function openNameModal(sheet, i) {
  activeCell = { sheet, i };
  modalSquare.textContent = BINGO_SQUARES[sheet.cells[i]];
  nameInput.value = "";
  modalBackdrop.hidden = false;
  nameInput.focus();
}

function closeNameModal() {
  activeCell = null;
  modalBackdrop.hidden = true;
}

// Only a named person crosses a square off — an empty entry keeps it open.
function saveName() {
  if (!activeCell) return;
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const { sheet, i } = activeCell;
  sheet.marks[i] = true;
  sheet.names[i] = name;
  saveSheet(sheet);
  paintCell(sheet, i);
  paintWins(sheet);
  closeNameModal();
}

function unmarkSquare(sheet, i) {
  if (!confirm(`Remove ${sheet.names[i]} from this square?`)) return;
  sheet.marks[i] = false;
  sheet.names[i] = "";
  saveSheet(sheet);
  paintCell(sheet, i);
  paintWins(sheet);
}

nameSaveBtn.addEventListener("click", saveName);
nameCancelBtn.addEventListener("click", closeNameModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeNameModal();
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveName();
  if (e.key === "Escape") closeNameModal();
});

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
  const sheet = { cells: generateCells(), marks: Array(9).fill(false), names: Array(9).fill("") };
  saveSheet(sheet);
  showBoard(sheet);
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Start a new sheet? Your current squares, names and crosses will be lost.")) return;
  localStorage.removeItem(BINGO_STORAGE_KEY);
  showIntro();
});

// A saved sheet takes priority: refreshing must never hand out a new one.
const savedSheet = loadSheet();
if (savedSheet) showBoard(savedSheet);
else showIntro();

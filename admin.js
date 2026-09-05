// Admin page behaviour (admin.html): sign in with the committee key,
// search TMDB for a film, then add it to the line-up with a screening
// date and a blurb. Everything goes through films.php, so the TMDB key
// never appears in the browser. Saving rewrites films.json + films.js on
// the server, which the public pages load.
//
// Wrapped in an IIFE because script.js (also loaded here, for the drawer
// and its date helpers) already declares a global `films`.

(() => {

const $ = (id) => document.getElementById(id);

const gate = $("adminGate");
const gateKeyInput = $("gateKeyInput");
const gateSignIn = $("gateSignIn");
const gateError = $("gateError");
const app = $("adminApp");

const lineupList = $("lineup");
const searchForm = $("searchForm");
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");
const searchStatus = $("searchStatus");
const searchResults = $("searchResults");
const manualAddBtn = $("manualAddBtn");

const filmForm = $("filmForm");
const formHeading = $("formHeading");
const fields = {
  id: $("fId"),
  title: $("fTitle"),
  year: $("fYear"),
  date: $("fDate"),
  poster: $("fPoster"),
  backdrop: $("fBackdrop"),
  url: $("fUrl"),
  director: $("fDirector"),
  runtime: $("fRuntime"),
  genres: $("fGenres"),
  synopsis: $("fSynopsis"),
  blurb: $("fBlurb"),
  content: $("fContent"),
  tmdb: $("fTmdb"),
};
const posterPreview = $("posterPreview");
const saveBtn = $("saveBtn");
const cancelBtn = $("cancelBtn");
const formError = $("formError");
const saveStatus = $("saveStatus");

let adminKey = localStorage.getItem("filmsocAdminKey") || "";
let films = [];       // the live line-up, as returned by films.php
let editingId = null; // slug of the film being edited; null when adding
let slugEdited = false; // has the admin typed in the slug box by hand?
let autoUrl = "";     // the Letterboxd URL generated from the current slug

async function post(body) {
  const res = await fetch("films.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A remembered key may be stale (e.g. after changing it in config.php).
    if (res.status === 403 && adminKey) {
      adminKey = "";
      localStorage.removeItem("filmsocAdminKey");
      location.reload();
    }
    throw new Error(data.error || "Something went wrong — please try again.");
  }
  return data;
}

/* ── Sign-in gate ───────────────────────────────────── */

function revealApp() {
  gate.hidden = true;
  app.hidden = false;
  loadFilms();
}

async function tryKey(key, quiet) {
  gateError.hidden = true;
  try {
    await post({ action: "auth", key });
    adminKey = key;
    localStorage.setItem("filmsocAdminKey", key);
    gateKeyInput.value = "";
    revealApp();
  } catch (err) {
    if (quiet) return; // just show the gate again when a saved key is stale
    gateError.textContent = err.message;
    gateError.hidden = false;
  }
}

gateSignIn.addEventListener("click", () => {
  const key = gateKeyInput.value.trim();
  if (key) tryKey(key, false);
});
gateKeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const key = gateKeyInput.value.trim();
    if (key) tryKey(key, false);
  }
});

if (adminKey) tryKey(adminKey, true);

/* ── Current line-up ────────────────────────────────── */

async function loadFilms() {
  try {
    const res = await fetch("films.php", { cache: "no-store" });
    if (!res.ok) throw new Error();
    films = (await res.json()).films || [];
    renderLineup();
  } catch {
    lineupList.replaceChildren();
    const li = document.createElement("li");
    li.textContent = "Couldn't load the line-up — this page needs the site to be served by its PHP host.";
    lineupList.appendChild(li);
  }
}

function renderLineup() {
  lineupList.replaceChildren();
  films.forEach((film) => {
    const li = document.createElement("li");

    const thumb = document.createElement("a");
    thumb.className = "poster-thumb";
    thumb.href = `film.html?id=${encodeURIComponent(film.id)}`;
    thumb.setAttribute("aria-label", `Preview ${film.title} on the public site`);
    const img = document.createElement("img");
    img.src = film.poster;
    img.alt = "";
    img.decoding = "async";
    thumb.appendChild(img);

    const meta = document.createElement("span");
    meta.className = "film-meta";
    const title = document.createElement("a");
    title.href = thumb.href;
    title.textContent = film.year ? `${film.title} (${film.year})` : film.title;
    const dateEl = document.createElement("span");
    dateEl.className = "film-date";
    dateEl.textContent = `${formatDate(parseISO(film.date))} · 7pm`;
    meta.append(title, dateEl);

    const actions = document.createElement("span");
    actions.className = "lineup-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "mini-btn";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => startEdit(film));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini-btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => removeFilm(film));
    actions.append(edit, del);

    li.append(thumb, meta, actions);
    lineupList.appendChild(li);
  });
}

async function removeFilm(film) {
  if (!confirm(`Remove ${film.title} from the line-up? (Its reviews stay stored in case you re-add it.)`)) return;
  try {
    const data = await post({ action: "delete", key: adminKey, id: film.id });
    films = data.films;
    renderLineup();
    if (editingId === film.id) resetForm();
    showStatus(`Removed ${film.title}.`);
  } catch (err) {
    showError(err.message);
  }
}

/* ── TMDB search ────────────────────────────────────── */

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching…";
  searchResults.replaceChildren();
  searchStatus.hidden = false;
  searchStatus.textContent = "Searching TMDB…";
  try {
    const data = await post({ action: "search", key: adminKey, q });
    renderSearchResults(data.results || []);
  } catch (err) {
    searchStatus.textContent = err.message;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Search";
  }
});

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.replaceChildren();
    searchStatus.textContent = "No matches — check the spelling, or add the film manually below.";
    return;
  }
  searchStatus.hidden = true;
  results.forEach((r) => {
    const li = document.createElement("li");

    const img = document.createElement("img");
    img.src = r.poster || "images/placeholder.svg";
    img.alt = "";
    img.decoding = "async";

    const body = document.createElement("div");
    body.className = "tmdb-result-body";
    const titleLine = document.createElement("p");
    titleLine.className = "tmdb-result-title";
    titleLine.textContent = r.title;
    if (r.year) {
      const year = document.createElement("span");
      year.className = "tmdb-result-year";
      year.textContent = String(r.year);
      titleLine.appendChild(year);
    }
    const overview = document.createElement("p");
    overview.className = "tmdb-result-overview";
    overview.textContent = r.overview || "No synopsis on TMDB.";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "admin-btn";
    add.textContent = "Select";
    add.addEventListener("click", () => selectResult(r));
    body.append(titleLine, overview, add);

    li.append(img, body);
    searchResults.appendChild(li);
  });
}

// Once a film has been picked (or manual add started), tidy the search
// area away so the form below is the focus.
function clearSearch() {
  searchInput.value = "";
  searchResults.replaceChildren();
  searchStatus.hidden = true;
}

async function selectResult(r) {
  searchStatus.hidden = false;
  searchStatus.textContent = `Loading ${r.title}…`;
  try {
    const d = await post({ action: "details", key: adminKey, tmdb: r.tmdb });
    // If this exact film is already scheduled, edit it instead of adding a
    // second copy.
    const existing = films.find((f) => f.tmdb && f.tmdb === d.tmdb);
    clearSearch();
    if (existing) {
      startEdit(existing);
      searchStatus.hidden = false;
      searchStatus.textContent = `Already scheduled (${formatDate(parseISO(existing.date))}) — opened it for editing.`;
    } else {
      startAdd(d);
    }
  } catch (err) {
    searchStatus.hidden = false;
    searchStatus.textContent = err.message;
  }
}

manualAddBtn.addEventListener("click", () => {
  clearSearch();
  startAdd({});
});

/* ── The add/edit form ──────────────────────────────── */

function slugify(title) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents left by the NFKD split
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 61)
    .replace(/-+$/g, "") || "film";
}

function uniqueSlug(title, year) {
  const taken = new Set(films.map((f) => f.id));
  const base = slugify(title);
  if (!taken.has(base)) return base;
  if (year && !taken.has(`${base}-${year}`)) return `${base}-${year}`.slice(0, 61);
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`.slice(0, 61);
}

function fillForm(film) {
  fields.title.value = film.title || "";
  fields.year.value = film.year || "";
  fields.date.value = film.date || "";
  fields.poster.value = film.poster || "";
  fields.backdrop.value = film.backdrop || "";
  fields.url.value = film.url || "";
  fields.director.value = film.director || "";
  fields.runtime.value = film.runtime || "";
  fields.genres.value = (film.genres || []).join(", ");
  fields.synopsis.value = film.synopsis || "";
  fields.blurb.value = film.blurb || "";
  fields.content.value = film.content || "";
  fields.tmdb.value = film.tmdb || 0;
  updatePosterPreview();
}

function startAdd(details) {
  editingId = null;
  formHeading.textContent = details.title ? `Add: ${details.title}` : "Add a film";
  const slug = uniqueSlug(details.title || "", details.year);
  fields.id.disabled = false;
  fields.id.value = slug;
  fillForm(details);
  fields.poster.value = details.poster || "images/placeholder.svg";
  fields.url.value = details.url || `https://letterboxd.com/film/${slug}/`;
  autoUrl = fields.url.value;
  slugEdited = false;
  cancelBtn.hidden = false;
  formError.hidden = true;
  filmForm.scrollIntoView({ behavior: "smooth", block: "start" });
  fields.date.focus();
}

function startEdit(film) {
  editingId = film.id;
  formHeading.textContent = `Edit: ${film.title}`;
  // The slug keys film.html URLs and stored reviews, so it stays put once
  // a film exists.
  fields.id.value = film.id;
  fields.id.disabled = true;
  fillForm(film);
  cancelBtn.hidden = false;
  formError.hidden = true;
  filmForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  editingId = null;
  formHeading.textContent = "Film details";
  fields.id.disabled = false;
  filmForm.reset();
  fields.tmdb.value = 0;
  fields.poster.value = "";
  posterPreview.src = "images/placeholder.svg";
  cancelBtn.hidden = true;
  formError.hidden = true;
  slugEdited = false;
  autoUrl = "";
}

// While adding, the slug (and the default Letterboxd link derived from it)
// follow the title — until the slug box is edited by hand.
function syncSlugFromTitle() {
  if (editingId !== null || slugEdited) return;
  const slug = uniqueSlug(fields.title.value.trim(), parseInt(fields.year.value, 10) || 0);
  fields.id.value = slug;
  if (fields.url.value.trim() === autoUrl || fields.url.value.trim() === "") {
    autoUrl = `https://letterboxd.com/film/${slug}/`;
    fields.url.value = autoUrl;
  }
}
fields.title.addEventListener("input", syncSlugFromTitle);
fields.year.addEventListener("input", syncSlugFromTitle);
fields.id.addEventListener("input", () => { slugEdited = true; });

cancelBtn.addEventListener("click", resetForm);

function updatePosterPreview() {
  posterPreview.src = fields.poster.value.trim() || "images/placeholder.svg";
}
posterPreview.onerror = () => { posterPreview.src = "images/placeholder.svg"; };
fields.poster.addEventListener("input", updatePosterPreview);

function collectFilm() {
  const film = {
    id: fields.id.value.trim().toLowerCase(),
    title: fields.title.value.trim(),
    year: parseInt(fields.year.value, 10) || 0,
    date: fields.date.value,
    poster: fields.poster.value.trim(),
    backdrop: fields.backdrop.value.trim(),
    url: fields.url.value.trim(),
    director: fields.director.value.trim(),
    runtime: parseInt(fields.runtime.value, 10) || 0,
    genres: fields.genres.value.split(",").map((g) => g.trim()).filter(Boolean),
    synopsis: fields.synopsis.value.trim(),
    blurb: fields.blurb.value.trim(),
    content: fields.content.value.trim(),
    tmdb: parseInt(fields.tmdb.value, 10) || 0,
  };
  if (!film.title) {
    formError.textContent = "A title is required.";
    formError.hidden = false;
    return null;
  }
  if (!film.date) {
    formError.textContent = "Pick a screening date.";
    formError.hidden = false;
    return null;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(film.id)) {
    formError.textContent = "The slug can only use lowercase letters, numbers and hyphens.";
    formError.hidden = false;
    return null;
  }
  return film;
}

filmForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;
  const film = collectFilm();
  if (!film) return;
  const wasEditing = editingId !== null;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    const data = await post({ action: "save", key: adminKey, film });
    films = data.films;
    renderLineup();
    resetForm();
    showStatus(wasEditing ? `Saved changes to ${film.title}.` : `Added ${film.title} — it's live on the public pages.`);
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save film";
  }
});

let statusTimer = null;
function showStatus(msg) {
  saveStatus.textContent = msg;
  saveStatus.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { saveStatus.hidden = true; }, 6000);
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

})();

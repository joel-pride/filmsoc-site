// Films shown in the carousel. Edit this list to change the line-up —
// each entry needs a local poster in images/ and a Letterboxd URL.
// Screenings are weekly: films[0] shows today, films[i] shows i weeks later.
const films = [
  { title: "The Godfather",     year: 1972, poster: "images/the-godfather.jpg",     url: "https://letterboxd.com/film/the-godfather/" },
  { title: "Spirited Away",     year: 2001, poster: "images/spirited-away.jpg",     url: "https://letterboxd.com/film/spirited-away/" },
  { title: "Interstellar",      year: 2014, poster: "images/interstellar.jpg",      url: "https://letterboxd.com/film/interstellar/" },
  { title: "Whiplash",          year: 2014, poster: "images/whiplash.jpg",          url: "https://letterboxd.com/film/whiplash/" },
  { title: "Blade Runner 2049", year: 2017, poster: "images/blade-runner-2049.jpg", url: "https://letterboxd.com/film/blade-runner-2049/" },
  { title: "La La Land",        year: 2016, poster: "images/la-la-land.jpg",        url: "https://letterboxd.com/film/la-la-land/" },
  { title: "Inception",         year: 2010, poster: "images/inception.jpg",         url: "https://letterboxd.com/film/inception/" },
  { title: "Fight Club",        year: 1999, poster: "images/fight-club.jpg",        url: "https://letterboxd.com/film/fight-club/" },
];

// Screening date for films[i]: today for the first film, +1 week per film after.
function screeningDate(i) {
  const d = new Date();
  d.setDate(d.getDate() + i * 7);
  return d;
}

function plusWeeks(base, weeks) {
  const d = new Date(base);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/* ── Side drawer (all pages) ─────────────────────────── */

const drawer = document.getElementById("sideDrawer");
const backdrop = document.getElementById("drawerBackdrop");
const menuBtn = document.getElementById("menuBtn");
const drawerClose = document.getElementById("drawerClose");

function openDrawer() {
  drawer.classList.add("open");
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add("visible"));
  document.body.classList.add("no-scroll", "drawer-open");
  menuBtn.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  drawer.classList.remove("open");
  backdrop.classList.remove("visible");
  document.body.classList.remove("no-scroll", "drawer-open");
  menuBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => { if (!drawer.classList.contains("open")) backdrop.hidden = true; }, 300);
}

if (menuBtn && drawer) {
  menuBtn.addEventListener("click", openDrawer);
  drawerClose.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
  });
}

// Highlight the current page's link in the drawer.
const currentPage = document.body.dataset.page;
document.querySelectorAll(".drawer-links a").forEach((link) => {
  if (link.dataset.nav === currentPage) link.classList.add("active");
});

/* ── Poster carousel (home page) ─────────────────────── */

const trackEl = document.getElementById("track");

if (trackEl) {
  const COPIES = 3; // three overlapping copies of the line-up for seamless wrap-around
  const n = films.length;
  const total = n * COPIES;
  let v = n; // virtual position of the centred card (middle copy): films[0] — this week's film — starts centred
  let timeline = 0; // unbounded week counter: 0 = the initial view; each arrow press moves ±1 week
  let animating = false;
  const today = new Date();

  // Build the track: each card is a copy of films[i % n]; dates are set in updateDistances().
  for (let i = 0; i < total; i++) {
    const filmIndex = ((i % n) + n) % n;
    const film = films[filmIndex];
    const fig = document.createElement("figure");
    fig.className = "card";
    const dateLabel = document.createElement("div");
    dateLabel.className = "card-date";
    const link = document.createElement("a");
    link.className = "poster-link";
    link.href = film.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", `View ${film.title} (${film.year}) on Letterboxd`);
    const img = document.createElement("img");
    img.className = "poster";
    img.src = film.poster;
    img.alt = `${film.title} (${film.year}) poster`;
    img.decoding = "async";
    link.appendChild(img);
    const caption = document.createElement("figcaption");
    caption.className = "card-title";
    caption.innerHTML = `<span class="film-title">${film.title}</span><span class="film-year">${film.year}</span>`;
    fig.append(dateLabel, link, caption);
    trackEl.appendChild(fig);
  }
  const cards = [...trackEl.children];
  const cardDates = cards.map((c) => c.querySelector(".card-date"));

  function cardStep() {
    const gap = parseFloat(getComputedStyle(trackEl).columnGap || getComputedStyle(trackEl).gap) || 0;
    return cards[0].getBoundingClientRect().width + gap;
  }

  // Centre card v: the track's left edge starts at the stage centre.
  function position() {
    const step = cardStep();
    trackEl.style.transform = `translateX(${-(v * step + cards[0].getBoundingClientRect().width / 2)}px)`;
  }

  // Distance classes drive scale/opacity, and each card's date comes from the
  // week timeline: films[0] sits one slot left of the initial centre, so it
  // shows today; every step right is a week later, every step left a week
  // earlier — continuing backwards/forwards forever.
  function updateDistances() {
    cards.forEach((card, i) => {
      const d = i - v;
      if (Math.abs(d) <= 2) {
        card.dataset.dist = String(d);
        delete card.dataset.far;
      } else {
        card.dataset.far = "";
        delete card.dataset.dist;
      }
      const weeks = timeline + d; // the centred card sits on the current week of the timeline
      const dateText = formatDate(plusWeeks(today, weeks));
      cardDates[i].innerHTML = weeks === 0
        ? `${dateText} <span class="week-tag">(this week)</span>`
        : dateText;
    });
  }

  // After a slide, silently re-anchor v into the middle copy so the
  // track can keep travelling in either direction forever. Visible cards
  // swap to their identical twins, so nothing appears to change.
  function settle() {
    if (v >= n && v < n * 2) return;
    trackEl.classList.add("no-transition");
    v = (((v % n) + n) % n) + n;
    position();
    updateDistances();
    trackEl.getBoundingClientRect(); // force reflow at the new position
    trackEl.classList.remove("no-transition");
  }

  function cycle(dir) {
    if (animating || n === 0) return;
    animating = true;
    v += dir;
    timeline += dir;
    updateDistances();
    position();
    setTimeout(() => {
      settle();
      animating = false;
    }, 520);
  }

  document.getElementById("prevBtn").addEventListener("click", () => cycle(-1));
  document.getElementById("nextBtn").addEventListener("click", () => cycle(1));

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") cycle(-1);
    if (e.key === "ArrowRight") cycle(1);
  });

  // Swipe support on touch screens.
  let touchStartX = null;
  trackEl.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  trackEl.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 45) cycle(delta < 0 ? 1 : -1);
    touchStartX = null;
  }, { passive: true });

  // Keep the centred card in place when the viewport resizes.
  window.addEventListener("resize", () => {
    trackEl.classList.add("no-transition");
    position();
    trackEl.getBoundingClientRect();
    trackEl.classList.remove("no-transition");
  });

  // Initial layout without a slide-in animation.
  trackEl.classList.add("no-transition");
  updateDistances();
  position();
  requestAnimationFrame(() => requestAnimationFrame(() => trackEl.classList.remove("no-transition")));
}

/* ── Programme list (films page) ─────────────────────── */

// Fill in real screening dates matching the carousel: row i = today + i weeks.
const programmeRows = document.querySelectorAll(".programme li");
programmeRows.forEach((row, i) => {
  if (i >= films.length) return;
  const dateEl = row.querySelector(".film-date");
  if (dateEl) dateEl.textContent = `${formatDate(screeningDate(i))} · 7pm`;
});

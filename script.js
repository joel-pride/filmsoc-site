// Shared behaviour for every page: side drawer, home carousel, programme
// list and the per-film detail page. The line-up itself lives in films.js
// (loaded just before this file).

const films = typeof FILMS === "undefined" ? [] : FILMS;

function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatRuntime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function filmPageUrl(film) {
  return `film.html?id=${encodeURIComponent(film.id)}`;
}

// Same Monday–Sunday week as today → "this week".
function sameWeekAsToday(d) {
  const monday = (x) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
    return c;
  };
  return monday(d).getTime() === monday(new Date()).getTime();
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
  const n = films.length;
  const thisWeekIndex = films.findIndex((f) => sameWeekAsToday(parseISO(f.date)));
  let v = thisWeekIndex >= 0 ? thisWeekIndex : 0; // land on this week's film
  let animating = false;

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  // Build the track: one card per film, dated from the film's own entry.
  films.forEach((film, i) => {
    const fig = document.createElement("figure");
    fig.className = "card";
    const dateLabel = document.createElement("div");
    dateLabel.className = "card-date";
    const dt = parseISO(film.date);
    dateLabel.innerHTML = i === thisWeekIndex
      ? `${formatDate(dt)} <span class="week-tag">(this week)</span>`
      : formatDate(dt);
    const link = document.createElement("a");
    link.className = "poster-link";
    link.href = filmPageUrl(film);
    link.setAttribute("aria-label", `View ${film.title} (${film.year}) — details and reviews`);
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
  });
  const cards = [...trackEl.children];

  function cardStep() {
    const gap = parseFloat(getComputedStyle(trackEl).columnGap || getComputedStyle(trackEl).gap) || 0;
    return cards[0].getBoundingClientRect().width + gap;
  }

  // Centre card v: the track's left edge starts at the stage centre.
  function position() {
    const step = cardStep();
    trackEl.style.transform = `translateX(${-(v * step + cards[0].getBoundingClientRect().width / 2)}px)`;
  }

  // Distance classes drive scale/opacity; arrows disable at the ends.
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
    });
    prevBtn.disabled = v === 0;
    nextBtn.disabled = v === n - 1;
  }

  function cycle(dir) {
    if (animating || n === 0) return;
    const next = v + dir;
    if (next < 0 || next >= n) return; // stop at the ends — no wrap-around
    animating = true;
    v = next;
    updateDistances();
    position();
    setTimeout(() => { animating = false; }, 520);
  }

  prevBtn.addEventListener("click", () => cycle(-1));
  nextBtn.addEventListener("click", () => cycle(1));

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

// The list is generated from the same data as the carousel, so there's a
// single source of truth for the line-up. Status chips are derived from
// each film's screening date.
const programmeList = document.getElementById("programme");

if (programmeList) {
  function chipFor(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((parseISO(dateStr) - today) / 86400000);
    if (days < 0) return { label: "Screened", dim: true };
    if (days === 0) return { label: "Today", dim: false };
    const weeks = Math.ceil(days / 7);
    if (weeks === 1) return { label: "Next week", dim: true };
    if (weeks === 2) return { label: "In 2 weeks", dim: true };
    return { label: "Upcoming", dim: true };
  }

  films.forEach((film) => {
    const li = document.createElement("li");

    const thumb = document.createElement("a");
    thumb.className = "poster-thumb";
    thumb.href = filmPageUrl(film);
    thumb.setAttribute("aria-label", `${film.title} — details and reviews`);
    const img = document.createElement("img");
    img.src = film.poster;
    img.alt = `${film.title} poster`;
    img.decoding = "async";
    thumb.appendChild(img);

    const meta = document.createElement("span");
    meta.className = "film-meta";
    const title = document.createElement("a");
    title.href = filmPageUrl(film);
    title.textContent = `${film.title} (${film.year})`;
    const dateEl = document.createElement("span");
    dateEl.className = "film-date";
    dateEl.textContent = `${formatDate(parseISO(film.date))} · 7pm`;
    meta.append(title, dateEl);

    const chip = document.createElement("span");
    const c = chipFor(film.date);
    chip.className = c.dim ? "chip dim" : "chip";
    chip.textContent = c.label;

    li.append(thumb, meta, chip);
    programmeList.appendChild(li);
  });
}

/* ── Film detail page (film.html) ────────────────────── */

const filmPage = document.getElementById("filmPage");

if (filmPage) {
  const id = new URLSearchParams(location.search).get("id");
  const film = films.find((f) => f.id === id);

  if (!film) {
    const h1 = document.createElement("h1");
    h1.textContent = "Film not found";
    const p = document.createElement("p");
    p.textContent = "That film isn't in this term's programme — it may have been shown in an earlier season.";
    const a = document.createElement("a");
    a.href = "films.html";
    a.textContent = "Back to all screenings";
    filmPage.replaceChildren(h1, p, a);
  } else {
    populateFilmPage(film);
    setupReviews(film);
  }
}

function populateFilmPage(film) {
  document.title = `${film.title} (${film.year}) — FilmSoc`;

  const poster = document.getElementById("filmPoster");
  poster.src = film.poster;
  poster.alt = `${film.title} (${film.year}) poster`;

  document.getElementById("filmTitle").textContent = film.title;
  document.getElementById("filmFacts").textContent =
    `${film.year} · Directed by ${film.director} · ${formatRuntime(film.runtime)} · ${film.genres.join(" / ")}`;
  document.getElementById("filmSynopsis").textContent = film.synopsis;

  const lbLink = document.getElementById("lbLink");
  lbLink.href = film.url;
  lbLink.setAttribute("aria-label", `View ${film.title} on Letterboxd (opens in a new tab)`);

  document.getElementById("screeningWhen").textContent =
    `${formatDate(parseISO(film.date))} · Doors 7:00pm · Film 7:15pm`;
  document.getElementById("screeningWhere").textContent = "Avenue Lecture Theatre B";
  document.getElementById("screeningBlurb").textContent = film.blurb;

  const notes = document.getElementById("screeningNotes");
  if (film.content) {
    notes.hidden = false;
    notes.textContent = `Content notes: ${film.content}`;
  }
}

function setupReviews(film) {
  const form = document.getElementById("reviewForm");
  const nameInput = document.getElementById("reviewName");
  const textInput = document.getElementById("reviewText");
  const submitBtn = document.getElementById("submitBtn");
  const formError = document.getElementById("formError");
  const reviewsNote = document.getElementById("reviewsNote");
  const reviewsList = document.getElementById("reviewsList");
  const noReviews = document.getElementById("noReviews");
  const avgBlock = document.getElementById("avgBlock");
  const avgStarsFill = document.getElementById("avgStarsFill");
  const avgText = document.getElementById("avgText");
  const starBtns = [...document.querySelectorAll(".star-btn")];

  const adminArea = document.getElementById("adminArea");
  const adminPanel = document.getElementById("adminPanel");
  const adminToggleBtn = document.getElementById("adminToggleBtn");
  const adminLogin = document.getElementById("adminLogin");
  const adminKeyInput = document.getElementById("adminKeyInput");
  const adminSignIn = document.getElementById("adminSignIn");
  const adminError = document.getElementById("adminError");
  const adminControls = document.getElementById("adminControls");
  const adminStatus = document.getElementById("adminStatus");
  const adminOpenBtn = document.getElementById("adminOpenBtn");
  const adminSignOut = document.getElementById("adminSignOut");

  const api = `reviews.php?film=${encodeURIComponent(film.id)}`;

  let selectedRating = 0;
  let reviewsOpen = false;
  let currentReviews = [];
  let reviewsBroken = false;
  let adminKey = localStorage.getItem("filmsocAdminKey") || "";

  async function post(body) {
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong — please try again.");
    return data;
  }

  function paintStars(n) {
    starBtns.forEach((btn) => btn.classList.toggle("on", Number(btn.dataset.value) <= n));
  }

  starBtns.forEach((btn) => {
    const value = Number(btn.dataset.value);
    btn.addEventListener("click", () => {
      selectedRating = value;
      paintStars(value);
      formError.hidden = true;
    });
    btn.addEventListener("mouseenter", () => paintStars(value));
    btn.addEventListener("focus", () => paintStars(value));
  });
  document.querySelector(".star-picker").addEventListener("mouseleave", () => paintStars(selectedRating));

  // User-submitted text is always added with textContent, never HTML.
  function renderReviews(reviews) {
    reviewsList.replaceChildren();
    noReviews.hidden = reviews.length > 0 || !reviewsOpen;
    reviews.slice().reverse().forEach((r) => {
      const li = document.createElement("li");
      li.className = "review";
      const head = document.createElement("div");
      head.className = "review-head";
      const name = document.createElement("span");
      name.className = "review-name";
      name.textContent = r.name;
      const stars = document.createElement("span");
      stars.className = "review-stars";
      stars.setAttribute("aria-label", `${r.rating} out of 5 stars`);
      stars.textContent = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
      const date = document.createElement("span");
      date.className = "review-date";
      date.textContent = new Date(r.ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      head.append(name, stars, date);
      if (adminKey && r.id) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "review-delete";
        del.textContent = "Delete";
        del.setAttribute("aria-label", `Delete review by ${r.name}`);
        del.addEventListener("click", async () => {
          if (!confirm(`Delete this review by ${r.name}?`)) return;
          adminError.hidden = true;
          try {
            applyState(await post({ action: "delete", key: adminKey, id: r.id }));
          } catch (err) {
            showAdminError(err.message);
          }
        });
        head.appendChild(del);
      }
      const text = document.createElement("p");
      text.className = "review-text";
      text.textContent = r.review;
      li.append(head, text);
      reviewsList.appendChild(li);
    });
  }

  function renderAverage(reviews) {
    avgBlock.hidden = reviews.length === 0;
    if (!reviews.length) return;
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    avgStarsFill.style.width = `${(avg / 5) * 100}%`;
    avgText.textContent = `${avg.toFixed(1)} from ${reviews.length} rating${reviews.length === 1 ? "" : "s"}`;
  }

  // One payload shape from every endpoint: { open, reviews }.
  function applyState(data) {
    reviewsOpen = Boolean(data.open);
    currentReviews = data.reviews || [];
    form.hidden = !reviewsOpen;
    if (!reviewsBroken) {
      reviewsNote.hidden = reviewsOpen;
      reviewsNote.textContent = "Reviews are closed right now — they usually open after the screening, so check back soon!";
    }
    renderAverage(currentReviews);
    renderReviews(currentReviews);
    updateAdminUI();
  }

  function showAdminError(msg) {
    adminError.textContent = msg;
    adminError.hidden = false;
  }

  function updateAdminUI() {
    const signedIn = Boolean(adminKey);
    adminLogin.hidden = signedIn;
    adminControls.hidden = !signedIn;
    adminStatus.textContent = reviewsOpen ? "Reviews are open" : "Reviews are closed";
    adminOpenBtn.textContent = reviewsOpen ? "Close reviews" : "Open reviews";
  }

  async function signIn() {
    adminError.hidden = true;
    const key = adminKeyInput.value.trim();
    if (!key) {
      showAdminError("Enter the admin key.");
      return;
    }
    try {
      await post({ action: "auth", key });
      adminKey = key;
      localStorage.setItem("filmsocAdminKey", key);
      adminKeyInput.value = "";
      updateAdminUI();
      renderReviews(currentReviews);
    } catch (err) {
      showAdminError(err.message);
    }
  }

  adminToggleBtn.addEventListener("click", () => { adminPanel.hidden = !adminPanel.hidden; });
  adminSignIn.addEventListener("click", signIn);
  adminKeyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); });

  adminSignOut.addEventListener("click", () => {
    adminKey = "";
    localStorage.removeItem("filmsocAdminKey");
    updateAdminUI();
    renderReviews(currentReviews);
  });

  adminOpenBtn.addEventListener("click", async () => {
    adminError.hidden = true;
    try {
      applyState(await post({ action: "set-open", key: adminKey, open: !reviewsOpen }));
    } catch (err) {
      showAdminError(err.message);
    }
  });

  function reviewsUnavailable() {
    reviewsBroken = true;
    form.hidden = true;
    adminArea.hidden = true;
    reviewsNote.hidden = false;
    reviewsNote.textContent = "Reviews can't be loaded right now — this feature needs the site to be served by its PHP host (it won't work opened straight from disk).";
  }

  async function loadReviews() {
    try {
      const res = await fetch(api);
      if (!res.ok) throw new Error();
      applyState(await res.json());
      // A key remembered from a previous session may be stale (e.g. after
      // changing ADMIN_KEY) — quietly drop it if the server rejects it.
      if (adminKey) {
        try {
          await post({ action: "auth", key: adminKey });
        } catch {
          adminKey = "";
          localStorage.removeItem("filmsocAdminKey");
          updateAdminUI();
          renderReviews(currentReviews);
        }
      }
    } catch {
      reviewsUnavailable();
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;

    const review = textInput.value.trim();
    if (!selectedRating) {
      formError.textContent = "Please pick a star rating.";
      formError.hidden = false;
      return;
    }
    if (!review) {
      formError.textContent = "Please write a few words about the film.";
      formError.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Posting…";
    try {
      const data = await post({ name: nameInput.value.trim(), rating: selectedRating, review });
      form.reset();
      selectedRating = 0;
      paintStars(0);
      applyState(data);
    } catch (err) {
      formError.textContent = err.message;
      formError.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post review";
    }
  });

  loadReviews();
}

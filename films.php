<?php
// JSON API behind admin.html (the committee's line-up manager), plus a
// small proxy to TMDB so the API key never reaches the browser.
//
//   GET  films.php
//        → { films: [ {id, title, ...}, ... ] }   the whole line-up, same
//          shape as films.js, sorted by screening date
//
//   POST films.php (JSON body) — every action requires the admin key:
//        { action: "auth", key }                check the admin key
//        { action: "search", key, q }           search TMDB by title
//        { action: "details", key, tmdb }       one TMDB film, normalised
//        { action: "save", key, film }          add or update one film
//        { action: "delete", key, id }          remove a film by id
//
// The line-up lives in films.json next to this file. Every save also
// regenerates films.js — the file the public pages load — so this folder
// must be writable by the web server, exactly like reviews.json.

declare(strict_types=1);

const FILMS_FILE = __DIR__ . '/films.json';
const JS_FILE = __DIR__ . '/films.js';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function respond(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (!is_file(__DIR__ . '/config.php')) {
    respond(500, ['error' => 'config.php is missing — copy config-sample.php to config.php and fill in your keys.']);
}
require __DIR__ . '/config.php';

function is_admin(array $input): bool {
    return isset($input['key']) && is_string($input['key']) && hash_equals(ADMIN_KEY, $input['key']);
}

function load_films(): array {
    if (!is_file(FILMS_FILE)) return [];
    $decoded = json_decode((string) file_get_contents(FILMS_FILE), true);
    return is_array($decoded) ? array_values($decoded) : [];
}

// Writes films.json and regenerates films.js (the file films.html,
// index.html and film.html load). Both stay sorted by screening date so
// films[0] opens the season, as the public pages expect.
function persist_films(array $films): bool {
    usort($films, fn($a, $b) => strcmp((string) ($a['date'] ?? ''), (string) ($b['date'] ?? '')));
    $flags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
    if (file_put_contents(FILMS_FILE, json_encode($films, $flags) . "\n", LOCK_EX) === false) return false;
    $header = "// The term's line-up. GENERATED FILE — films.php writes this whenever the\n"
        . "// line-up is edited from admin.html, so don't change it by hand (your\n"
        . "// edits would be overwritten on the next save); use admin.html instead.\n"
        . "//\n"
        . "// Each entry: id (slug used in film.html?id=... URLs and to key stored\n"
        . "// reviews), poster (local path or URL), date (ISO screening date),\n"
        . "// url (the film's Letterboxd page) plus detail-page fields (director,\n"
        . "// runtime, genres, synopsis, blurb, content).\n"
        . 'const FILMS = ';
    return file_put_contents(JS_FILE, $header . json_encode($films, $flags) . ";\n", LOCK_EX) !== false;
}

/* ── TMDB proxy ─────────────────────────────────────── */

function tmdb_get(string $path, array $params): array {
    if (TMDB_KEY === '' || strpos(TMDB_KEY, 'PASTE') === 0) {
        respond(503, ['error' => 'No TMDB key configured — add it to config.php first.']);
    }
    $headers = ['Accept: application/json'];
    // v4 read tokens are JWTs (they start "eyJ") and use bearer auth; v3
    // API keys go on the query string.
    if (strpos(TMDB_KEY, 'eyJ') === 0) {
        $headers[] = 'Authorization: Bearer ' . TMDB_KEY;
    } else {
        $params['api_key'] = TMDB_KEY;
    }
    $params['language'] = $params['language'] ?? 'en-GB';
    $url = TMDB_BASE . $path . '?' . http_build_query($params);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 15,
        ]);
        $body = curl_exec($ch);
        $err = (string) curl_error($ch);
        // no curl_close(): it's been a no-op since PHP 8.0 and warns on 8.5+
    } else {
        $context = stream_context_create(['http' => [
            'timeout' => 15,
            'header' => implode("\r\n", $headers),
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $context);
        $err = $body === false ? 'request failed' : '';
    }
    if ($body === false || $body === '') {
        respond(502, ['error' => "Couldn't reach TMDB just now — try again in a moment." . ($err !== '' ? " ({$err})" : '')]);
    }
    $decoded = json_decode((string) $body, true);
    if (!is_array($decoded)) respond(502, ['error' => 'TMDB returned something unexpected.']);
    // TMDB errors carry status_code/status_message; success responses don't.
    if (isset($decoded['status_code'], $decoded['status_message'])) {
        respond(502, ['error' => 'TMDB rejected the request — check the key in config.php. (' . (int) $decoded['status_code'] . ')']);
    }
    return $decoded;
}

function tmdb_poster(?string $path): string {
    return $path !== null && $path !== '' ? 'https://image.tmdb.org/t/p/w500' . $path : '';
}

function tmdb_year(?string $release_date): ?int {
    if ($release_date !== null && preg_match('/^\d{4}/', $release_date, $m) === 1) return (int) $m[0];
    return null;
}

/* ── Film validation ────────────────────────────────── */

// Validates and normalises one film entry from the admin form. Field order
// matches the original films.js entries, so regenerated files read the
// same as hand-written ones.
function clean_film(array $f): array {
    $clip = fn(string $key, int $max) => mb_substr(trim((string) ($f[$key] ?? '')), 0, $max);

    $id = strtolower(trim((string) ($f['id'] ?? '')));
    if (preg_match('/^[a-z0-9][a-z0-9-]{0,60}$/', $id) !== 1) {
        respond(422, ['error' => 'The slug can only use lowercase letters, numbers and hyphens.']);
    }

    $title = $clip('title', 200);
    if ($title === '') respond(422, ['error' => 'A title is required.']);

    $date = trim((string) ($f['date'] ?? ''));
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        respond(422, ['error' => 'Pick a real screening date.']);
    }

    $year = filter_var($f['year'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1880, 'max_range' => 2100]]);
    if ($year === false || $year === null) $year = (int) $m[1]; // fall back to the screening year

    $runtime = filter_var($f['runtime'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1440]]);
    if ($runtime === false || $runtime === null) $runtime = 0;

    $genres = [];
    foreach ((array) ($f['genres'] ?? []) as $g) {
        $g = trim((string) $g);
        if ($g !== '' && mb_strlen($g) <= 40) $genres[] = $g;
        if (count($genres) >= 6) break;
    }

    $poster = trim((string) ($f['poster'] ?? ''));
    if ($poster === '') $poster = 'images/placeholder.svg';
    if (mb_strlen($poster) > 500) respond(422, ['error' => 'The poster URL is too long.']);

    $url = trim((string) ($f['url'] ?? ''));
    if ($url !== '' && (mb_strlen($url) > 300 || preg_match('#^https?://#i', $url) !== 1)) {
        respond(422, ['error' => 'The link must start with http:// or https:// (or be left empty).']);
    }

    $tmdb = filter_var($f['tmdb'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if ($tmdb === false || $tmdb === null) $tmdb = 0;

    $clean = [
        'id'       => $id,
        'title'    => $title,
        'year'     => $year,
        'date'     => $date,
        'poster'   => $poster,
        'url'      => $url,
        'director' => $clip('director', 200),
        'runtime'  => $runtime,
        'genres'   => $genres,
        'synopsis' => $clip('synopsis', 2000),
        'blurb'    => $clip('blurb', 1000),
        'content'  => $clip('content', 300),
    ];
    if ($tmdb > 0) $clean['tmdb'] = $tmdb; // kept so "already scheduled" checks work later
    return $clean;
}

/* ── Request dispatch ───────────────────────────────── */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') respond(405, ['error' => 'Method not allowed.']);

if ($method === 'GET') {
    respond(200, ['films' => load_films()]);
}

$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) respond(400, ['error' => 'Invalid request body.']);
$action = $input['action'] ?? '';

if ($action === 'auth') {
    if (!is_admin($input)) respond(403, ['error' => 'Invalid admin key.']);
    respond(200, ['ok' => true]);
}

// Everything below (including the TMDB proxy) needs a valid key, so this
// endpoint can't be borrowed as a free TMDB API.
if (!is_admin($input)) respond(403, ['error' => 'Invalid admin key.']);

if ($action === 'search') {
    $q = trim((string) ($input['q'] ?? ''));
    if ($q === '' || mb_strlen($q) > 100) respond(422, ['error' => 'Enter a title to search for (max 100 characters).']);
    $data = tmdb_get('/search/movie', ['query' => $q, 'include_adult' => 'false']);
    $results = [];
    foreach (array_slice((array) ($data['results'] ?? []), 0, 12) as $r) {
        $results[] = [
            'tmdb'     => (int) ($r['id'] ?? 0),
            'title'    => (string) ($r['title'] ?? ''),
            'year'     => tmdb_year($r['release_date'] ?? null),
            'poster'   => tmdb_poster($r['poster_path'] ?? null),
            'overview' => mb_substr(trim((string) ($r['overview'] ?? '')), 0, 300),
        ];
    }
    respond(200, ['results' => $results]);
}

if ($action === 'details') {
    $tmdb = filter_var($input['tmdb'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($tmdb === false || $tmdb === null) respond(422, ['error' => 'Missing TMDB id.']);
    $data = tmdb_get('/movie/' . $tmdb, ['append_to_response' => 'credits']);
    $directors = [];
    foreach ((array) ($data['credits']['crew'] ?? []) as $crew) {
        if (($crew['job'] ?? '') === 'Director' && ($crew['name'] ?? '') !== '') $directors[] = (string) $crew['name'];
    }
    respond(200, [
        'tmdb'     => (int) ($data['id'] ?? $tmdb),
        'title'    => (string) ($data['title'] ?? ''),
        'year'     => tmdb_year($data['release_date'] ?? null),
        'director' => implode(', ', array_slice($directors, 0, 3)),
        'runtime'  => max(0, (int) ($data['runtime'] ?? 0)),
        'genres'   => array_values(array_filter(array_map(
            fn($g) => trim((string) ($g['name'] ?? '')),
            (array) ($data['genres'] ?? [])
        ))),
        'synopsis' => trim((string) ($data['overview'] ?? '')),
        'poster'   => tmdb_poster($data['poster_path'] ?? null),
    ]);
}

if ($action === 'save') {
    if (!is_array($input['film'] ?? null)) respond(422, ['error' => 'Missing film to save.']);
    $film = clean_film($input['film']);
    $films = load_films();
    $replaced = false;
    foreach ($films as $i => $existing) {
        if (($existing['id'] ?? '') === $film['id']) {
            $films[$i] = $film;
            $replaced = true;
            break;
        }
    }
    if (!$replaced) $films[] = $film;
    if (!persist_films($films)) respond(500, ['error' => 'Could not save — films.json and films.js must be writable by the web server.']);
    respond(200, ['ok' => true, 'films' => $films]);
}

if ($action === 'delete') {
    $id = $input['id'] ?? '';
    if (!is_string($id) || preg_match('/^[a-z0-9][a-z0-9-]{0,60}$/', $id) !== 1) respond(422, ['error' => 'Invalid film id.']);
    $films = load_films();
    $kept = array_values(array_filter($films, fn($f) => ($f['id'] ?? '') !== $id));
    if (count($kept) === count($films)) respond(404, ['error' => "That film isn't in the line-up."]);
    // Any reviews stored for it stay in reviews.json, so re-adding the film
    // (with the same slug) brings them back.
    if (!persist_films($kept)) respond(500, ['error' => 'Could not save — films.json and films.js must be writable by the web server.']);
    respond(200, ['ok' => true, 'films' => $kept]);
}

respond(400, ['error' => 'Unknown action.']);

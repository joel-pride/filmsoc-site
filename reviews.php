<?php
// Tiny JSON API backing the reviews on film.html, plus the admin controls.
//
//   GET  reviews.php?film=<id>
//        → { open: bool, reviews: [ {id, name, rating, review, ts}, ... ] }
//
//   POST reviews.php?film=<id>   (JSON body)
//        { name, rating, review }                  add a review (must be open)
//        { action: "import-letterboxd", user }     pull the user's Letterboxd
//                                                   review of THIS film out of
//                                                   their public RSS feed and
//                                                   store it (must be open)
//        { action: "auth", key }                   check the admin key
//        { action: "set-open", key, open: bool }   open / close this film's reviews
//        { action: "delete", key, id }             delete one review by id
//
// ADMIN KEY: lives in config.php (copy config-sample.php there if it
// doesn't exist yet) and is shared with films.php / admin.html. It lives
// only on the server — visitors never see it — and is required for
// deleting reviews and opening/closing the system.
//
// Reviews for a film are CLOSED by default; open them from the Admin panel
// on the film's page once you're ready to take reviews (e.g. after the
// screening). Stored in reviews.json next to this file, created on first
// write, so this folder must be writable by the web server.

declare(strict_types=1);

const DATA_FILE = __DIR__ . '/reviews.json';

function respond(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (!is_file(__DIR__ . '/config.php')) {
    respond(500, ['error' => 'config.php is missing — copy config-sample.php to config.php and fill in your keys.']);
}
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

function is_admin(array $input): bool {
    return isset($input['key']) && is_string($input['key']) && hash_equals(ADMIN_KEY, $input['key']);
}

function load_all(): array {
    if (!is_file(DATA_FILE)) return [];
    $decoded = json_decode((string) file_get_contents(DATA_FILE), true);
    return is_array($decoded) ? $decoded : [];
}

function save_all(array $all): bool {
    return file_put_contents(DATA_FILE, json_encode($all, JSON_PRETTY_PRINT), LOCK_EX) !== false;
}

// Normalised per-film entry: { open: bool, reviews: list }. Films not yet
// in the file default to closed with no reviews.
function film_entry(array $all, string $id): array {
    $entry = $all[$id] ?? null;
    if ($entry === null) return ['open' => false, 'reviews' => []];
    // Reviews written before the open/closed flag existed were a plain list.
    if (!isset($entry['open']) && !isset($entry['reviews'])) {
        return ['open' => false, 'reviews' => array_values((array) $entry)];
    }
    return [
        'open'    => (bool) ($entry['open'] ?? false),
        'reviews' => isset($entry['reviews']) && is_array($entry['reviews']) ? array_values($entry['reviews']) : [],
    ];
}

function payload(array $all, string $id): array {
    $entry = film_entry($all, $id);
    return ['open' => $entry['open'], 'reviews' => $entry['reviews']];
}

// Film ids are slugs like "whiplash-2014"; anything else is rejected so
// junk can't end up as a key in reviews.json.
function film_id(): ?string {
    $id = $_GET['film'] ?? $_POST['film'] ?? '';
    return (is_string($id) && preg_match('/^[a-z0-9][a-z0-9-]{0,60}$/', $id) === 1) ? $id : null;
}

/* ── Letterboxd import ─────────────────────────────────────────────── */

// Members can review on Letterboxd instead of the site. The action above
// pulls ONE review — the user's review of THIS film — out of their public
// RSS feed (letterboxd.com/<user>/rss/, no API key needed) and stores it
// alongside the native reviews. Nothing else in their feed is read or
// kept. Feeds are cached for two minutes per username so a roomful of
// members hammering the button doesn't hammer Letterboxd.

const LB_CACHE_DIR = __DIR__ . '/letterboxd-cache';
const LB_CACHE_TTL = 120;

// The slugs this film's review can hide behind in an RSS item link. The
// film id is normally the Letterboxd slug already, but ids like "parasite"
// link to "parasite-2019" — films.json's url field is the truth there.
function letterboxd_slugs(string $id): array {
    $slugs = [$id];
    $films = json_decode((string) @file_get_contents(__DIR__ . '/films.json'), true);
    if (is_array($films)) {
        foreach ($films as $film) {
            if (($film['id'] ?? null) !== $id) continue;
            if (isset($film['url']) && preg_match('#letterboxd\.com/film/([a-z0-9-]+)#', $film['url'], $m)) {
                array_unshift($slugs, $m[1]);
            }
            break;
        }
    }
    return array_values(array_unique($slugs));
}

// Fetch the user's feed through the short-lived cache. Returns the raw
// XML, or null if it couldn't be fetched; $status gets the HTTP status
// (0 = couldn't connect at all). Uses ext-curl, which php:8.3-apache
// ships with, for real status codes (404 = no such user).
function fetch_letterboxd_rss(string $user, int &$status): ?string {
    if (!is_dir(LB_CACHE_DIR)) @mkdir(LB_CACHE_DIR, 0775, true);
    $cache = LB_CACHE_DIR . '/' . md5(strtolower($user)) . '.xml';

    if (is_file($cache) && time() - filemtime($cache) < LB_CACHE_TTL) {
        $status = 200;
        return (string) file_get_contents($cache);
    }

    $ch = curl_init("https://letterboxd.com/{$user}/rss/");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_USERAGENT      => 'FilmSoc review importer',
    ]);
    $xml = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    unset($ch);

    if ($status === 200 && is_string($xml) && $xml !== '') {
        @file_put_contents($cache, $xml, LOCK_EX);
        return $xml;
    }
    // Letterboxd hiccuped — a stale cached feed beats an error.
    if (is_file($cache)) {
        $status = 200;
        return (string) file_get_contents($cache);
    }
    return null;
}

// Pull the user's review of this film out of their feed. Items are matched
// on the /film/<slug>/ part of their link, so other films, lists and logs
// are never touched. Rating-only logs (no text) don't count as reviews.
// With several matches (a rewatch), the newest wins. Returns a review
// shape, or null if this film isn't in the feed.
function find_letterboxd_review(string $xml, array $slugs, string $user): ?array {
    $rss = @simplexml_load_string($xml);
    if ($rss === false || !isset($rss->channel->item)) return null;

    $best = null;
    foreach ($rss->channel->item as $item) {
        // Only genuine reviews import. Letterboxd tags each feed item's
        // guid with its type — watch logs (letterboxd-watch-…), lists and
        // stories are all skipped, so a rating-only log never shows up.
        $guid = (string) $item->guid;
        if (strpos($guid, 'letterboxd-review-') !== 0) continue;

        $link = (string) $item->link;
        $matched = false;
        foreach ($slugs as $slug) {
            if (strpos($link, "/film/{$slug}/") !== false) { $matched = true; break; }
        }
        if (!$matched) continue;

        // The description is a poster <img> followed by the review's HTML;
        // dropping the img, the tags and the entities leaves just the text.
        $html = preg_replace('#<img[^>]*>#i', '', (string) $item->description);
        $text = trim((string) preg_replace('/\s+/', ' ', html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5)));
        // Belt and braces: a lone "Watched on Sunday November 10, 2019."
        // line is log boilerplate, not a review. Full match only, so a
        // review that merely starts with "Watched on a plane…" survives.
        if ($text === '' || preg_match('/^(?:watched|rewatched) on [a-z]+ [a-z]+ \d{1,2}, \d{4}\.?$/i', $text)) continue;

        $lb = $item->children('letterboxd', true);
        $dc = $item->children('dc', true);
        $rawRating = trim((string) ($lb->memberRating ?? ''));
        if ($rawRating !== '') {
            $rating = round(((float) $rawRating) * 2) / 2;          // half-star steps
            $rating = fmod($rating, 1) === 0.0 ? (int) $rating : $rating; // store 4, not 4.0
        } else {
            $rating = null;                                         // rating-less reviews exist
        }
        $name = trim((string) ($dc->creator ?? ''));
        $ts = strtotime((string) $item->pubDate);

        $candidate = [
            'name'   => $name !== '' ? $name : $user,
            'rating' => $rating,
            'review' => mb_substr($text, 0, 2000),
            'link'   => $link,
            'ts'     => $ts !== false ? $ts : time(),
        ];
        if ($best === null || $candidate['ts'] >= $best['ts']) $best = $candidate;
    }
    return $best;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') respond(405, ['error' => 'Method not allowed.']);

if ($method === 'GET') {
    $id = film_id();
    if ($id === null) respond(400, ['error' => 'Invalid film id.']);
    respond(200, payload(load_all(), $id));
}

// POST — dispatch on the body's action.
$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) respond(400, ['error' => 'Invalid request body.']);
$action = $input['action'] ?? 'add';

if ($action === 'auth') {
    if (!is_admin($input)) respond(403, ['error' => 'Invalid admin key.']);
    respond(200, ['ok' => true]);
}

$id = film_id();
if ($id === null) respond(400, ['error' => 'Invalid film id.']);

if ($action === 'set-open') {
    if (!is_admin($input)) respond(403, ['error' => 'Invalid admin key.']);
    if (!is_bool($input['open'] ?? null)) respond(422, ['error' => '"open" must be true or false.']);
    $all = load_all();
    $entry = film_entry($all, $id);
    $entry['open'] = $input['open'];
    $all[$id] = $entry;
    if (!save_all($all)) respond(500, ['error' => 'Could not save — reviews.json is not writable.']);
    respond(200, payload($all, $id));
}

if ($action === 'delete') {
    if (!is_admin($input)) respond(403, ['error' => 'Invalid admin key.']);
    $reviewId = $input['id'] ?? '';
    if (!is_string($reviewId) || $reviewId === '') respond(422, ['error' => 'Missing review id.']);
    $all = load_all();
    $entry = film_entry($all, $id);
    $kept = array_values(array_filter(
        $entry['reviews'],
        fn($r) => ($r['id'] ?? null) !== $reviewId
    ));
    if (count($kept) === count($entry['reviews'])) respond(404, ['error' => 'Review not found.']);
    $entry['reviews'] = $kept;
    $all[$id] = $entry;
    if (!save_all($all)) respond(500, ['error' => 'Could not save — reviews.json is not writable.']);
    respond(200, payload($all, $id));
}

if ($action === 'import-letterboxd') {
    $user = trim((string) ($input['user'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{1,30}$/', $user)) {
        respond(422, ['error' => "That doesn't look like a Letterboxd username — it's the name in your profile URL (letters, numbers, - and _)."]);
    }

    $all = load_all();
    $entry = film_entry($all, $id);
    if (!$entry['open']) respond(403, ['error' => 'Reviews are closed for this film right now.']);

    $status = 0;
    $xml = fetch_letterboxd_rss($user, $status);
    if ($status === 404) {
        respond(404, ['error' => "No Letterboxd user called \"{$user}\" — check the spelling (it's the name in your profile URL)."]);
    }
    if ($xml === null) {
        respond(502, ['error' => 'Letterboxd could not be reached — try again in a moment.']);
    }

    $found = find_letterboxd_review($xml, letterboxd_slugs($id), $user);
    if ($found === null) {
        respond(404, ['error' => "Couldn't find a written review of this film by {$user} — logging or rating it isn't enough, it needs an actual review. If you only just posted it, Letterboxd's feed can take a few minutes to catch up — try again shortly."]);
    }

    // Re-importing replaces the previous copy rather than stacking
    // duplicates, so editing the review on Letterboxd and submitting again
    // updates it in place.
    $luser = strtolower($user);
    $entry['reviews'] = array_values(array_filter(
        $entry['reviews'],
        fn($r) => (($r['lb']['user'] ?? null) !== $luser)
    ));
    $entry['reviews'][] = [
        'id'     => bin2hex(random_bytes(6)),
        'name'   => mb_substr($found['name'], 0, 50),
        'rating' => $found['rating'],
        'review' => $found['review'],
        'ts'     => $found['ts'],
        'lb'     => ['user' => $luser, 'link' => $found['link']],
    ];
    $all[$id] = $entry;

    if (!save_all($all)) respond(500, ['error' => 'Could not save the review — reviews.json is not writable.']);

    respond(201, payload($all, $id));
}

// Default action: add a review. Only allowed while the film's reviews are open.
$all = load_all();
$entry = film_entry($all, $id);
if (!$entry['open']) respond(403, ['error' => 'Reviews are closed for this film right now.']);

$name = trim((string) ($input['name'] ?? ''));
$text = trim((string) ($input['review'] ?? ''));
$rating = filter_var($input['rating'] ?? null, FILTER_VALIDATE_FLOAT);

if ($name === '') $name = 'Anonymous';
if (mb_strlen($name) > 50) $name = mb_substr($name, 0, 50);
if ($text === '') respond(422, ['error' => 'Please write a review first.']);
if (mb_strlen($text) > 2000) respond(422, ['error' => 'Reviews are limited to 2000 characters.']);
// Ratings go in half-star steps: 0.5, 1, 1.5 … 5.
if ($rating === false || $rating === null || $rating < 0.5 || $rating > 5 || fmod($rating * 2, 1) !== 0.0) {
    respond(422, ['error' => 'Ratings go in half-star steps from 0.5 to 5 stars.']);
}
$rating = fmod($rating, 1) === 0.0 ? (int) $rating : $rating; // store 4 as 4, not 4.0

$entry['reviews'][] = [
    'id'     => bin2hex(random_bytes(6)),
    'name'   => $name,
    'rating' => $rating,
    'review' => $text,
    'ts'     => time(),
];
$all[$id] = $entry;

if (!save_all($all)) respond(500, ['error' => 'Could not save the review — reviews.json is not writable.']);

respond(201, payload($all, $id));

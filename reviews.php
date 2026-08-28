<?php
// Tiny JSON API backing the reviews on film.html, plus the admin controls.
//
//   GET  reviews.php?film=<id>
//        → { open: bool, reviews: [ {id, name, rating, review, ts}, ... ] }
//
//   POST reviews.php?film=<id>   (JSON body)
//        { name, rating, review }                  add a review (must be open)
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

<?php
// Shared secrets for the PHP endpoints (reviews.php, films.php).
//
// 1. Copy this file to config.php — config.php is gitignored, so the real
//    keys never end up in the repo.
// 2. Paste your TMDB key into TMDB_KEY: either the v3 API key or the v4
//    read access token from themoviedb.org → Settings → API.
// 3. ADMIN_KEY is what the committee signs in with on admin.html and the
//    review admin panel.

declare(strict_types=1);

const ADMIN_KEY = 'joel';
const TMDB_KEY = 'PASTE-YOUR-TMDB-KEY-HERE';

<?php
// The "site in development" password gate.
//
// Apache (see deploy/) bounces every request that doesn't carry the
// filmsoc_gate cookie to this page. The right password (GATE_PASSWORD in
// config.php) sets that cookie to the server's secret token (.gate-token),
// which Apache then honours for 30 days.

declare(strict_types=1);

require __DIR__ . '/config.php';

header('Cache-Control: no-store');

// If the gate was switched off after launch (GATE_ENABLED=false in
// compose.yaml), don't leave a stray password page lying around.
if (getenv('GATE_ENABLED') === 'false') {
    header('Location: /');
    exit;
}

// Where to send the visitor once they're in. Apache passes the original
// path as ?to=…; only same-site paths starting with a single "/" are OK.
$to = '/';
if (isset($_GET['to']) && preg_match('#^/(?!/)[^\r\n\0]*$#', $_GET['to'])) {
    $to = $_GET['to'];
}

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
    if ($password !== '' && hash_equals(GATE_PASSWORD, $password)) {
        $token = @file_get_contents(__DIR__ . '/.gate-token');
        $token = $token === false ? '' : trim($token);
        if (preg_match('/^[a-f0-9]{64}$/', $token) === 1) {
            // HTTPS terminates at Caddy, so this container only sees the
            // forwarded scheme; allow plain http too so local testing works.
            $https = (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
                  || (($_SERVER['HTTPS'] ?? '') === 'on');
            setcookie('filmsoc_gate', $token, [
                'expires'  => time() + 60 * 60 * 24 * 30, // 30 days
                'path'     => '/',
                'secure'   => $https,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
            header('Location: ' . $to);
            exit;
        }
        $error = 'The gate is not set up on the server yet (missing .gate-token) — restart the filmsoc container to create it.';
    } else {
        usleep(400000); // make password guessing slow
        $error = "That password isn't right — try again.";
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#16181d">
  <title>Coming soon — Southampton Film Society</title>
  <link rel="icon" href="data:,">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Tinos:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #16181d;
      --bg-raised: #1d2027;
      --accent: #7c5cbf;
      --accent-bright: #9d82d6;
      --text: #f2f2f5;
      --text-muted: #9aa0ae;
      --radius: 10px;
      --font-display: "Tinos", "Times New Roman", Times, serif;
      --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color-scheme: dark;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background:
        radial-gradient(1200px 480px at 50% -120px, rgba(124, 92, 191, 0.16), transparent 65%),
        var(--bg);
      background-repeat: no-repeat;
      color: var(--text);
      font-family: var(--font-body);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .gate-card {
      width: 100%;
      max-width: 380px;
      text-align: center;
      background: var(--bg-raised);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--radius);
      padding: 40px 32px 32px;
    }
    .gate-mark { color: var(--accent-bright); margin-bottom: 14px; }
    h1 {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 26px;
      letter-spacing: 0.02em;
      margin-bottom: 8px;
    }
    .gate-sub {
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 26px;
    }
    .gate-error {
      color: #ff9a9a;
      background: rgba(255, 138, 138, 0.08);
      border: 1px solid rgba(255, 138, 138, 0.25);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 14px;
      line-height: 1.4;
      margin-bottom: 18px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px 14px;
      background: #14161b;
      border: 1px solid #2a2e38;
      border-radius: 8px;
      color: var(--text);
      font-size: 15px;
      font-family: inherit;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(124, 92, 191, 0.25);
    }
    button {
      width: 100%;
      margin-top: 14px;
      padding: 12px;
      background: var(--accent);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
    }
    button:hover { background: var(--accent-bright); }
    .gate-foot {
      margin-top: 26px;
      color: var(--text-muted);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main class="gate-card">
    <svg class="gate-mark" viewBox="0 0 24 24" width="42" height="42" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="12" cy="12" r="9.2"/>
      <circle cx="12" cy="7.4" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="16.4" cy="10.6" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="14.7" cy="15.6" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="9.3" cy="15.6" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="7.6" cy="10.6" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
    </svg>
    <h1>Southampton Film Society</h1>
    <p class="gate-sub">We're still putting the new season together. Enter the password for a sneak preview.</p>
    <?php if ($error !== ''): ?>
      <p class="gate-error" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
    <?php endif; ?>
    <form method="post">
      <label for="password" style="position:absolute;left:-9999px">Password</label>
      <input type="password" id="password" name="password" placeholder="Password"
             autocomplete="current-password" required autofocus>
      <button type="submit">Enter</button>
    </form>
    <p class="gate-foot">Films · Friends · Popcorn</p>
  </main>
</body>
</html>

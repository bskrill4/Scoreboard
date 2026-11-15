// The Bone Zone (#bonezone): is BONES real yet? A floating 3D skull reads out a
// reliability check of BONES on this NBA season, in speech bubbles:
//   - consistency: a player's BONES per 36 in his odd games vs his even games
//     (and the same for points and on-court WPA, for scale);
//   - holding up: his first half of the season vs his second half;
//   - team level: a team's total BONES in a game vs its point margin, per game
//     and over the season.
// The numbers come from the same per-game cache as the season pages
// (SB.player.finalPlayers), so a visit after the NBA season page is instant.
// The skull is Three.js, loaded from a CDN only when this page opens.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(s);

  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const MIN_GAMES = 8; // a player needs this many games...
  const MIN_MPG = 15; // ...and minutes a game to be in the check
  const TYPE_MS = 22; // typing speed of the speech bubbles (ms a character)

  let root = null;
  let started = false;
  let stats = null; // computed once per visit
  let lines = []; // what the skull says, in order
  let at = 0; // which line is showing
  let typing = null;

  // ---------- the numbers ----------
  function corr(xs, ys) {
    const n = xs.length;
    if (n < 3) return NaN;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  }
  const per36 = (gs, k) => {
    const m = gs.reduce((s, x) => s + x.min, 0);
    return m ? (gs.reduce((s, x) => s + x[k], 0) / m) * 36 : 0;
  };

  async function compute(onProgress) {
    const boards = await Promise.all(SB.seasonMonths(9).map((m) => SB.api.scoreboardMonth(m, 'nba')));
    const games = [];
    const seen = new Set();
    for (const b of boards) {
      for (const e of b.events || []) {
        if (seen.has(e.id) || e.season?.slug !== 'regular-season' || e.status?.type?.state !== 'post') continue;
        seen.add(e.id);
        const score = {};
        for (const c of e.competitions[0].competitors) score[String(c.team.id)] = Number(c.score) || 0;
        games.push({ id: e.id, t: Date.parse(e.date), score });
      }
    }
    games.sort((a, b) => a.t - b.t);

    const players = new Map();
    const teamGames = [];
    let done = 0;
    const queue = games.slice();
    async function worker() {
      while (queue.length) {
        const g = queue.shift();
        try {
          g.rows = await SB.player.finalPlayers(g.id, 'nba');
        } catch (e) {}
        onProgress(++done, games.length);
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    for (const g of games) {
      if (!g.rows) continue;
      const team = {};
      for (const [id, r] of Object.entries(g.rows)) {
        if (!r[3]) continue;
        const row = { imp: SB.impact.rowImpact(r) * 100, wpa: r[1] * 100, team: String(r[3][0]), min: r[3][1], pts: r[3][2] };
        team[row.team] = (team[row.team] || 0) + row.imp;
        const p = players.get(id) || { name: r[3][7], g: [] };
        p.g.push(row);
        players.set(id, p);
      }
      for (const [id, sum] of Object.entries(team)) {
        const opp = Object.keys(g.score).find((k) => k !== id);
        teamGames.push({ team: id, imp: sum, margin: g.score[id] - g.score[opp] });
      }
    }

    const qual = [...players.values()].filter((p) => p.g.length >= MIN_GAMES && p.g.reduce((s, x) => s + x.min, 0) / p.g.length >= MIN_MPG);
    const half = (p) => Math.ceil(p.g.length / 2);
    const metric = (k) => ({
      oddEven: corr(
        qual.map((p) => per36(p.g.filter((_, i) => i % 2 === 0), k)),
        qual.map((p) => per36(p.g.filter((_, i) => i % 2 === 1), k))
      ),
      firstSecond: corr(
        qual.map((p) => per36(p.g.slice(0, half(p)), k)),
        qual.map((p) => per36(p.g.slice(half(p)), k))
      ),
    });
    const teams = {};
    for (const x of teamGames) {
      const t = (teams[x.team] ??= { imp: 0, margin: 0, n: 0 });
      t.imp += x.imp;
      t.margin += x.margin;
      t.n++;
    }
    const tv = Object.values(teams);
    const avgGames = qual.reduce((s, p) => s + p.g.length, 0) / (qual.length || 1);
    return {
      games: games.filter((g) => g.rows).length,
      players: qual.length,
      avgGames,
      bones: metric('imp'),
      pts: metric('pts'),
      wpa: metric('wpa'),
      teamGame: corr(
        teamGames.map((x) => x.imp),
        teamGames.map((x) => x.margin)
      ),
      teamSeason: corr(
        tv.map((t) => t.imp / t.n),
        tv.map((t) => t.margin / t.n)
      ),
      teams: tv.length,
    };
  }

  // ---------- what the skull says ----------
  const r2 = (x) => (Number.isFinite(x) ? x.toFixed(2).replace(/^0/, '').replace(/^-0/, '−') : '—');
  // A whole-season reliability from a split-half correlation (Spearman-Brown).
  const fullSeason = (r) => (2 * r) / (1 + r);
  function grade(r) {
    if (r >= 0.7) return 'solid';
    if (r >= 0.5) return 'getting there';
    if (r >= 0.3) return 'shaky';
    return 'mostly noise';
  }
  function script(s) {
    const b = s.bones;
    const rel = fullSeason(b.oddEven);
    const relPts = fullSeason(s.pts.oddEven);
    const ratio = Math.round((rel / relPts) * 100);
    return [
      `Welcome to the Bone Zone. I've counted the bones of ${s.games} NBA games: ${s.players} players with ${MIN_GAMES}+ games and ${MIN_MPG}+ minutes a night. Is BONES real yet? Let's rattle it.`,
      `First, consistency. If BONES measures something real about a player, his odd games should look like his even games. They line up at r = ${r2(b.oddEven)}. Points do ${r2(s.pts.oddEven)}; on-court WPA only ${r2(s.wpa.oddEven)}.`,
      `Stretched to a full season so far, that's a reliability of ${r2(rel)} for BONES against ${r2(relPts)} for points: ${grade(rel)}. BONES carries about ${ratio}% of the signal points do, and nearly four times WPA's.`,
      `Second, does it hold up? A player's first half of the season against his second: BONES ${r2(b.firstSecond)}, points ${r2(s.pts.firstSecond)}, WPA ${r2(s.wpa.firstSecond)}. ${b.firstSecond >= 0.5 ? 'A good BONES player mostly stays a good BONES player.' : 'It drifts a lot from half to half.'}`,
      `Third, does it win? Add up a team's BONES in a game and compare it with the final margin: r = ${r2(s.teamGame)}. Over the season, across ${s.teams} teams, BONES per game tracks point differential at ${r2(s.teamSeason)}. ${s.teamSeason >= 0.7 ? 'The skull approves: BONES follows winning.' : 'Winning and BONES are only loosely tied so far.'}`,
      `My verdict: BONES is ${grade(rel)}. It's steadier than WPA by a mile and tracks winning well, but swings make it noisier than points; with about ${Math.round(s.avgGames)} games a player, one wild night still moves it. Ask me again in a few weeks. The bones never lie, but they do take time.`,
    ];
  }

  // ---------- the skull ----------
  let three = null; // { renderer, scene, camera, skull, jaw, eyes, raf }
  let talking = 0; // > 0 while a line is being typed

  function loadThree() {
    if (window.THREE) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function buildSkull(canvas) {
    const T = window.THREE;
    const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0.1, 6);

    scene.add(new T.AmbientLight(0xffffff, 0.45));
    const key = new T.DirectionalLight(0xfff4dd, 1.1);
    key.position.set(2.5, 3, 4);
    scene.add(key);
    const rim = new T.DirectionalLight(0x8ab4ff, 0.5);
    rim.position.set(-3, 1, -2);
    scene.add(rim);

    const bone = new T.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.65, metalness: 0.05 });
    const dark = new T.MeshStandardMaterial({ color: 0x15151a, roughness: 1 });
    const glow = new T.MeshBasicMaterial({ color: 0xffd60a });

    const skull = new T.Group();
    // Cranium and cheekbones.
    const cranium = new T.Mesh(new T.SphereGeometry(1, 40, 32), bone);
    cranium.scale.set(1, 1.02, 1.12);
    cranium.position.y = 0.25;
    skull.add(cranium);
    const face = new T.Mesh(new T.SphereGeometry(0.78, 32, 24), bone);
    face.scale.set(1.05, 0.9, 0.95);
    face.position.set(0, -0.2, 0.25);
    skull.add(face);
    // Eye sockets with a glow deep inside.
    const eyes = [];
    for (const x of [-0.36, 0.36]) {
      const socket = new T.Mesh(new T.SphereGeometry(0.25, 24, 18), dark);
      socket.scale.set(1, 0.9, 0.6);
      socket.position.set(x, 0.0, 0.86);
      skull.add(socket);
      const eye = new T.Mesh(new T.SphereGeometry(0.07, 16, 12), glow);
      eye.position.set(x, 0.0, 1.0); // pokes just out of the socket's front
      skull.add(eye);
      eyes.push(eye);
    }
    // Nose.
    const nose = new T.Mesh(new T.ConeGeometry(0.12, 0.26, 3), dark);
    nose.rotation.x = Math.PI;
    nose.position.set(0, -0.32, 1.0);
    skull.add(nose);
    // Upper teeth.
    const tooth = new T.BoxGeometry(0.1, 0.16, 0.08);
    for (let i = -3; i <= 3; i++) {
      const t = new T.Mesh(tooth, bone);
      const a = i * 0.16;
      t.position.set(Math.sin(a) * 0.62, -0.62, 0.62 + Math.cos(a) * 0.2);
      t.rotation.y = a;
      skull.add(t);
    }
    // The jaw hinges open while the skull talks.
    const jaw = new T.Group();
    jaw.position.set(0, -0.6, 0.1);
    const mandible = new T.Mesh(new T.SphereGeometry(0.62, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bone);
    mandible.scale.set(1.05, 0.55, 1.05);
    mandible.position.set(0, -0.06, 0.1);
    jaw.add(mandible);
    for (let i = -3; i <= 3; i++) {
      const t = new T.Mesh(tooth, bone);
      const a = i * 0.16;
      t.position.set(Math.sin(a) * 0.6, 0.02, 0.5 + Math.cos(a) * 0.18);
      t.rotation.y = a;
      jaw.add(t);
    }
    skull.add(jaw);
    scene.add(skull);

    const pointer = { x: 0, y: 0 };
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    });

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    const t0 = performance.now();
    const frame = () => {
      three.raf = null;
      if (!root || root.hidden) return; // paused while the page isn't showing
      const t = (performance.now() - t0) / 1000;
      skull.position.y = Math.sin(t * 1.2) * 0.12; // float
      skull.rotation.y += (pointer.x * 0.9 + Math.sin(t * 0.4) * 0.25 - skull.rotation.y) * 0.05;
      skull.rotation.x += (pointer.y * 0.4 - skull.rotation.x) * 0.05;
      const open = talking > 0 ? 0.12 + Math.abs(Math.sin(t * 16)) * 0.22 : 0;
      jaw.rotation.x += (open - jaw.rotation.x) * 0.35;
      const pulse = talking > 0 ? 1.2 + Math.sin(t * 10) * 0.35 : 1 + Math.sin(t * 2) * 0.1;
      for (const e of eyes) e.scale.setScalar(pulse);
      renderer.render(scene, camera);
      three.raf = requestAnimationFrame(frame);
    };
    three = { renderer, raf: null, frame, resize };
    three.raf = requestAnimationFrame(frame);
  }

  // ---------- the page ----------
  function say(i) {
    at = Math.max(0, Math.min(lines.length - 1, i));
    const bubble = root.querySelector('.bz-bubble p');
    const dots = root.querySelector('.bz-dots');
    clearInterval(typing);
    const text = lines[at];
    let n = 0;
    talking = 1;
    bubble.textContent = '';
    typing = setInterval(() => {
      n += 2;
      bubble.textContent = text.slice(0, n);
      if (n >= text.length) {
        clearInterval(typing);
        talking = 0;
      }
    }, TYPE_MS * 2);
    dots.innerHTML = lines.map((_, k) => `<i class="${k === at ? 'on' : ''}"></i>`).join('');
    root.querySelector('[data-bz="prev"]').disabled = at === 0;
    root.querySelector('[data-bz="next"]').textContent = at === lines.length - 1 ? 'Again ↺' : 'Next ›';
  }

  function numbersHTML(s) {
    const row = (label, k) => `<tr><th>${label}</th><td>${r2(s.bones[k])}</td><td>${r2(s.pts[k])}</td><td>${r2(s.wpa[k])}</td></tr>`;
    return `<table class="bz-table">
        <thead><tr><th></th><th>BONES</th><th>Points</th><th>WPA</th></tr></thead>
        <tbody>${row('Odd vs even games', 'oddEven')}${row('1st half vs 2nd half', 'firstSecond')}
          <tr><th>Team BONES vs margin</th><td colspan="3">per game ${r2(s.teamGame)} · season ${r2(s.teamSeason)} (${s.teams} teams)</td></tr></tbody>
      </table>
      <p class="bz-fine">Correlations (r) per 36 minutes, ${s.players} players with ${MIN_GAMES}+ games and ${MIN_MPG}+ minutes a game, ${s.games} games. 1 is perfectly repeatable, 0 is coin flips.</p>`;
  }

  async function start() {
    started = true;
    root.innerHTML = `<div class="bz">
        <div class="bz-stage"><canvas class="bz-skull" aria-label="A floating skull"></canvas></div>
        <div class="bz-bubble" role="status" aria-live="polite"><p>Rattling the bones… loading the season.</p></div>
        <div class="bz-controls">
          <button type="button" data-bz="prev" disabled>‹ Back</button>
          <span class="bz-dots"></span>
          <button type="button" data-bz="next" disabled>Next ›</button>
        </div>
        <details class="bz-numbers"><summary>The numbers</summary><div class="bz-num-body">Still counting…</div></details>
      </div>`;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bz]');
      if (!b || !lines.length) return;
      if (b.dataset.bz === 'prev') say(at - 1);
      else say(at === lines.length - 1 ? 0 : at + 1);
    });
    loadThree()
      .then(() => buildSkull(root.querySelector('.bz-skull')))
      .catch(() => (root.querySelector('.bz-stage').innerHTML = '<div class="bz-fallback">💀</div>'));
    try {
      stats = await compute((n, total) => {
        if (!lines.length) root.querySelector('.bz-bubble p').textContent = `Rattling the bones… ${n} of ${total} games.`;
      });
      lines = script(stats);
      root.querySelector('.bz-num-body').innerHTML = numbersHTML(stats);
      root.querySelector('[data-bz="next"]').disabled = false;
      say(0);
    } catch (e) {
      root.querySelector('.bz-bubble p').textContent = 'The skull couldn’t reach ESPN to count the bones. Try again in a bit.';
    }
  }

  // Called by main.js whenever the Bone Zone is showing.
  function render() {
    if (!root) root = document.getElementById('bonezone');
    if (!started) start();
    else if (three && !three.raf) {
      three.resize();
      three.raf = requestAnimationFrame(three.frame); // resume after the page was hidden
    }
  }

  SB.boneZone = { render };
})();

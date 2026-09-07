/* common.js - shared nav bar, stats helpers, sorting utility */

const PAGES = [
  { href: 'charts.html', label: 'Charts' },
  { href: 'leaderboard.html', label: 'Leaderboard' },
  { href: 'timemachine.html', label: 'Lookback' },
  { href: 'rankings.html', label: 'Rankings' }
];

function renderNav(activeHref) {
  const nav = document.createElement('nav');
  nav.className = 'topnav';
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = 'Big Brother DR Charts <span class="beta-tag">Beta</span>';
  nav.appendChild(brand);
  const links = document.createElement('div');
  links.className = 'nav-links';
  for (const p of PAGES) {
    const a = document.createElement('a');
    a.href = p.href;
    a.textContent = p.label;
    if (p.href === activeHref) a.className = 'active';
    links.appendChild(a);
  }
  nav.appendChild(links);
  document.body.insertBefore(nav, document.body.firstChild);
}

function renderFooter() {}

const AVATAR_PALETTE = ['#D9432B', '#E8652B', '#F2A20C', '#2E8B57', '#2274A5', '#6A4C93', '#C1447E', '#445E93'];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Seasons whose BrantSteele image folder doesn't match the plain zero-padded
// season number (e.g. split/reboot seasons use a lettered folder suffix).
const SEASON_IMAGE_FOLDER_OVERRIDES = { BB20: '20b', BB23: '23c', CBB1: '01b', CBB2: '02c' };

// Explicit headshot URLs for appearances whose BrantSteele filename doesn't
// follow the usual first-name-only slug pattern.
const NAME_IMAGE_OVERRIDES = {
  'BBOTT::Jason Roy': 'https://cdn.brantsteele.com/images/bigbrother/ott/01/jasonroy.png'
};

function headshotUrl(name, seasonId) {
  const override = window.Store && Store.getHeadshotOverride(seasonId, name);
  if (override) return override;
  const nameOverride = NAME_IMAGE_OVERRIDES[`${seasonId}::${name}`];
  if (nameOverride) return nameOverride;
  const folderOverride = SEASON_IMAGE_FOLDER_OVERRIDES[(seasonId || '').toUpperCase()];
  const usSeason = /^BB(\d+)$/i.exec(seasonId || '');
  const canadaSeason = /^BBCAN(\d+)$/i.exec(seasonId || '');
  const reindeerSeason = /^BBRG(\d+)?$/i.exec(seasonId || '');
  const ottSeason = /^BBOTT(\d+)?$/i.exec(seasonId || '');
  const celebritySeason = /^CBB(\d+)$/i.exec(seasonId || '');
  const slug = name.trim().split(/\s+/)[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!slug) return null;
  if (usSeason) return `https://cdn.brantsteele.com/images/bigbrother/${folderOverride || usSeason[1].padStart(2, '0')}/${slug}.png`;
  if (canadaSeason) return `https://cdn.brantsteele.com/images/bigbrother/canada/${canadaSeason[1].padStart(2, '0')}/${slug}.png`;
  if (reindeerSeason) return `https://cdn.brantsteele.com/images/bigbrother/reindeergames/${(reindeerSeason[1] || '1').padStart(2, '0')}/${slug}.png`;
  if (ottSeason) return `https://cdn.brantsteele.com/images/bigbrother/ott/${(ottSeason[1] || '1').padStart(2, '0')}/${slug}.png`;
  if (celebritySeason) return `https://cdn.brantsteele.com/images/bigbrother/celebrity/${folderOverride || celebritySeason[1].padStart(2, '0')}/${slug}.png`;
  return null;
}

/** Returns an HTML string: headshot + name, with initials as a load fallback. */
function nameCellHtml(name, seasonId, headshotName = name) {
  const headshot = headshotUrl(headshotName, seasonId);
  const fallback = `<span class="avatar" style="background:${colorForName(name)}">${escapeHtml(initialsFor(name))}</span>`;
  const image = headshot
    ? `<img class="headshot" src="${headshot}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
    : '';
  return `<span class="name-cell">${image}<span${headshot ? ' hidden' : ''}>${fallback}</span>${escapeHtml(name)}</span>`;
}

/** Returns an HTML string for a numbered rank chip (top 3 get special styling). */
function rankChipHtml(rank) {
  const cls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
  return `<span class="rank-chip ${cls}">${rank}</span>`;
}

/** Renders a row of {num, label} stat cards at the top of a page. */
function renderStatStrip(container, stats) {
  const strip = document.createElement('div');
  strip.className = 'stat-strip';
  for (const s of stats) {
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = `<div class="num">${escapeHtml(String(s.num))}</div><div class="lbl">${escapeHtml(s.label)}</div>`;
    strip.appendChild(div);
  }
  container.appendChild(strip);
}

/** A player is "active" for a given episode cell if it's a real logged count
 * (not a ghost DR, not blank/dead, not an empty slot). */
function isCountedCell(e) {
  return e.type === 'n' && !e.ghost;
}

function playerTotal(player) {
  return player.episodes.reduce((sum, e) => isCountedCell(e) ? sum + (e.value || 0) : sum, 0);
}

function playerCountedEpisodes(player) {
  return player.episodes.filter(isCountedCell).length;
}

function playerAverage(player) {
  const n = playerCountedEpisodes(player);
  if (n === 0) return null;
  return playerTotal(player) / n;
}

/** Cumulative total through and including a given episode number. */
function playerTotalThroughEpisode(player, episodeNum) {
  let sum = 0, n = 0;
  for (const e of player.episodes) {
    if (e.episode > episodeNum) break;
    if (isCountedCell(e)) { sum += (e.value || 0); n++; }
  }
  return { total: sum, count: n };
}

/** Episode number of a player's last counted (or blank/dead) appearance -
 * used to figure out when someone was evicted. Returns null if never blank. */
function playerEvictionEpisode(player) {
  const eps = player.episodes;
  let lastActive = -1;
  for (let i = eps.length - 1; i >= 0; i--) {
    if (isCountedCell(eps[i]) || eps[i].ghost) {
      lastActive = i;
      break;
    }
  }
  return lastActive >= 0 && lastActive < eps.length - 1 ? eps[lastActive + 1].episode : null;
}

/** Make a <table> sortable by clicking <th> cells. getSortValue(rowEl, colIndex) 
 * must return a comparable value (number or string) for the given column. */
function makeSortable(table, getSortValue) {
  const headers = table.querySelectorAll('thead th');
  let sortState = { col: null, dir: 1 };
  headers.forEach((th, colIndex) => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const dir = (sortState.col === colIndex) ? -sortState.dir : (colIndex <= 1 ? 1 : -1);
      sortState = { col: colIndex, dir };
      rows.sort((ra, rb) => {
        const va = getSortValue(ra, colIndex);
        const vb = getSortValue(rb, colIndex);
        if (va === vb) return 0;
        if (va === null || va === undefined || va === '') return 1;
        if (vb === null || vb === undefined || vb === '') return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
      rows.forEach(r => tbody.appendChild(r));
      headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
    });
  });
}

window.renderNav = renderNav;
window.renderFooter = renderFooter;
window.colorForName = colorForName;
window.initialsFor = initialsFor;
window.nameCellHtml = nameCellHtml;
window.rankChipHtml = rankChipHtml;
window.renderStatStrip = renderStatStrip;
window.isCountedCell = isCountedCell;
window.playerTotal = playerTotal;
window.playerCountedEpisodes = playerCountedEpisodes;
window.playerAverage = playerAverage;
window.playerTotalThroughEpisode = playerTotalThroughEpisode;
window.playerEvictionEpisode = playerEvictionEpisode;
window.makeSortable = makeSortable;

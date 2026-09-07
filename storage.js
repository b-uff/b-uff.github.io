/* storage.js
 * Thin localStorage-backed persistence layer.
 *
 * Keys:
 *   drchart:season:<ID>        -> full parsed season object (see numbers-parser.js)
 *   drchart:season-order       -> array of season IDs in upload order
 *   drchart:links              -> array of link-groups; each group is an array
 *                                  of {season, name} appearance refs that the
 *                                  user has explicitly linked as one person.
 *
 * Everything here is synchronous and browser-only. Swapping this module out
 * for one backed by a GitHub repo (fetch + a small write API) is the planned
 * upgrade path; nothing outside this file should know or care where the data
 * actually lives.
 */

const LS_SEASON_PREFIX = 'drchart:season:';
const LS_SEASON_ORDER = 'drchart:season-order';
const LS_LINKS = 'drchart:links';
const LS_HEADSHOTS = 'drchart:headshots';
const REFERENCE_IMAGE_DB = 'drchart-reference-images';
const referenceImages = new Map();
const seasonDetails = new Map();

function openReferenceImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REFERENCE_IMAGE_DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images');
      if (!request.result.objectStoreNames.contains('details')) request.result.createObjectStore('details');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putReferenceImage(id, image) {
  const db = await openReferenceImageDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction('images', 'readwrite').objectStore('images').put(image, id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function putSeasonDetail(id, detail) {
  const db = await openReferenceImageDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction('details', 'readwrite').objectStore('details').put(detail, id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function readStoredEntries(storeName) {
  const db = await openReferenceImageDb();
  const entries = await new Promise((resolve, reject) => {
    const entries = [];
    const request = db.transaction(storeName).objectStore(storeName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(entries);
      entries.push([cursor.key, cursor.value]);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  db.close();
  return entries;
}

const Store = {
  async hydrateReferenceImages() {
    for (const id of this.listSeasonIds()) {
      const raw = localStorage.getItem(LS_SEASON_PREFIX + id);
      if (!raw) continue;
      const season = JSON.parse(raw);
      if (season.referenceImage) {
        referenceImages.set(id, season.referenceImage);
        delete season.referenceImage;
        localStorage.setItem(LS_SEASON_PREFIX + id, JSON.stringify(season));
        await putReferenceImage(id, referenceImages.get(id));
      }
      const detail = {};
      for (const key of ['sourceGrid', 'columnWidths', 'rowHeights']) {
        if (season[key]) {
          detail[key] = season[key];
          delete season[key];
        }
      }
      if (Object.keys(detail).length) {
        seasonDetails.set(id, detail);
        localStorage.setItem(LS_SEASON_PREFIX + id, JSON.stringify(season));
        await putSeasonDetail(id, detail);
      }
    }
    for (const [id, image] of await readStoredEntries('images')) referenceImages.set(id, image);
    for (const [id, detail] of await readStoredEntries('details')) seasonDetails.set(id, detail);
  },

  loadPublishedData(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.seasons)) return false;
    const previousIds = this.listSeasonIds();
    for (const id of previousIds) localStorage.removeItem(LS_SEASON_PREFIX + id);
    for (const seasonData of snapshot.seasons) {
      const season = { ...seasonData };
      if (season.referenceImage) {
        referenceImages.set(season.id, season.referenceImage);
        putReferenceImage(season.id, season.referenceImage).catch(error => console.error('Could not save published reference image', error));
        delete season.referenceImage;
      }
      const detail = {};
      for (const key of ['sourceGrid', 'columnWidths', 'rowHeights']) {
        if (season[key]) {
          detail[key] = season[key];
          delete season[key];
        }
      }
      if (Object.keys(detail).length) {
        seasonDetails.set(season.id, detail);
        putSeasonDetail(season.id, detail).catch(error => console.error('Could not save published chart detail', error));
      }
      localStorage.setItem(LS_SEASON_PREFIX + season.id, JSON.stringify(season));
    }
    localStorage.setItem(LS_SEASON_ORDER, JSON.stringify(snapshot.seasons.map(season => season.id)));
    localStorage.setItem(LS_LINKS, JSON.stringify(snapshot.links || []));
    localStorage.setItem(LS_HEADSHOTS, JSON.stringify(snapshot.headshots || {}));
    return true;
  },

  listSeasonIds() {
    try {
      return JSON.parse(localStorage.getItem(LS_SEASON_ORDER) || '[]');
    } catch (e) {
      return [];
    }
  },

  setSeasonOrder(order) {
    const existing = new Set(this.listSeasonIds());
    const seen = new Set();
    const nextOrder = order.filter(id => existing.has(id) && !seen.has(id) && seen.add(id));
    for (const id of existing) {
      if (!seen.has(id)) nextOrder.push(id);
    }
    localStorage.setItem(LS_SEASON_ORDER, JSON.stringify(nextOrder));
    return nextOrder;
  },

  getSeason(id) {
    const raw = localStorage.getItem(LS_SEASON_PREFIX + id);
    if (!raw) return null;
    const season = JSON.parse(raw);
    if (referenceImages.has(id)) season.referenceImage = referenceImages.get(id);
    if (seasonDetails.has(id)) Object.assign(season, seasonDetails.get(id));
    return season;
  },

  getAllSeasons() {
    return this.listSeasonIds().map(id => this.getSeason(id)).filter(Boolean);
  },

  /** Save (or replace) a season's data. Re-uploading a season ID overwrites it. */
  saveSeason(id, seasonData) {
    const season = { ...seasonData };
    if (season.referenceImage) {
      referenceImages.set(id, season.referenceImage);
      putReferenceImage(id, season.referenceImage).catch(error => console.error('Could not save reference image', error));
      delete season.referenceImage;
    }
    const detail = {};
    for (const key of ['sourceGrid', 'columnWidths', 'rowHeights']) {
      if (season[key]) {
        detail[key] = season[key];
        delete season[key];
      }
    }
    if (Object.keys(detail).length) {
      seasonDetails.set(id, detail);
      putSeasonDetail(id, detail).catch(error => console.error('Could not save chart detail', error));
    }
    localStorage.setItem(LS_SEASON_PREFIX + id, JSON.stringify(season));
    const order = this.listSeasonIds();
    if (!order.includes(id)) {
      order.push(id);
      localStorage.setItem(LS_SEASON_ORDER, JSON.stringify(order));
    }
  },

  deleteSeason(id) {
    localStorage.removeItem(LS_SEASON_PREFIX + id);
    const order = this.listSeasonIds().filter(x => x !== id);
    localStorage.setItem(LS_SEASON_ORDER, JSON.stringify(order));
  },

  getHeadshotOverrides() {
    try {
      return JSON.parse(localStorage.getItem(LS_HEADSHOTS) || '{}');
    } catch (e) {
      return {};
    }
  },

  getHeadshotOverride(seasonId, name) {
    return this.getHeadshotOverrides()[seasonId + '::' + name] || null;
  },

  saveHeadshotOverride(seasonId, name, imageData) {
    const overrides = this.getHeadshotOverrides();
    overrides[seasonId + '::' + name] = imageData;
    localStorage.setItem(LS_HEADSHOTS, JSON.stringify(overrides));
  },

  renameAppearance(seasonId, oldName, newName) {
    const name = newName.trim();
    if (!name || name === oldName) return false;
    const season = this.getSeason(seasonId);
    const player = season && season.players.find(item => item.name === oldName);
    if (!player || season.players.some(item => item !== player && item.name === name)) return false;
    player.name = name;
    this.saveSeason(seasonId, season);
    const groups = this.getLinkGroups();
    for (const group of groups) {
      for (const appearance of group) {
        if (appearance.season === seasonId && appearance.name === oldName) appearance.name = name;
      }
    }
    this.saveLinkGroups(groups);
    return true;
  },

  renameAppearances(seasonId, changes) {
    const season = this.getSeason(seasonId);
    if (!season) return { saved: 0, rejected: 0 };
    const names = new Set(season.players.map(player => player.name));
    const validChanges = [];
    let rejected = 0;
    for (const change of changes) {
      const newName = change.newName.trim();
      if (newName === change.oldName) continue;
      if (!newName || !names.has(change.oldName) || names.has(newName)) {
        rejected++;
        continue;
      }
      names.delete(change.oldName);
      names.add(newName);
      validChanges.push({ oldName: change.oldName, newName });
    }
    if (!validChanges.length) return { saved: 0, rejected };
    for (const change of validChanges) {
      season.players.find(player => player.name === change.oldName).name = change.newName;
    }
    this.saveSeason(seasonId, season);
    const renamed = new Map(validChanges.map(change => [change.oldName, change.newName]));
    const groups = this.getLinkGroups();
    for (const group of groups) {
      for (const appearance of group) {
        if (appearance.season === seasonId && renamed.has(appearance.name)) appearance.name = renamed.get(appearance.name);
      }
    }
    this.saveLinkGroups(groups);
    return { saved: validChanges.length, rejected };
  },

  areAppearancesLinked(a, b) {
    return this.getLinkGroups().some(group =>
      group.some(item => item.season === a.season && item.name === a.name) &&
      group.some(item => item.season === b.season && item.name === b.name)
    );
  },

  // ---- Returning-player links ----

  getLinkGroups() {
    try {
      return JSON.parse(localStorage.getItem(LS_LINKS) || '[]');
    } catch (e) {
      return [];
    }
  },

  saveLinkGroups(groups) {
    localStorage.setItem(LS_LINKS, JSON.stringify(groups));
  },

  /** Link two appearances ({season,name}) together into one returning-player group. */
  linkAppearances(a, b) {
    const groups = this.getLinkGroups();
    const key = ap => ap.season + '::' + ap.name;
    let groupA = groups.find(g => g.some(ap => key(ap) === key(a)));
    let groupB = groups.find(g => g.some(ap => key(ap) === key(b)));
    if (groupA && groupA === groupB) return; // already linked
    if (groupA && groupB) {
      // merge
      groupA.push(...groupB.filter(ap => !groupA.some(x => key(x) === key(ap))));
      const idx = groups.indexOf(groupB);
      groups.splice(idx, 1);
    } else if (groupA) {
      if (!groupA.some(ap => key(ap) === key(b))) groupA.push(b);
    } else if (groupB) {
      if (!groupB.some(ap => key(ap) === key(a))) groupB.push(a);
    } else {
      groups.push([a, b]);
    }
    this.saveLinkGroups(groups);
  },

  unlinkAppearance(a) {
    const key = ap => ap.season + '::' + ap.name;
    let groups = this.getLinkGroups()
      .map(g => g.filter(ap => key(ap) !== key(a)))
      .filter(g => g.length > 1);
    this.saveLinkGroups(groups);
  },

  /** Returns the group (array of {season,name}) containing this appearance, or null. */
  findGroup(season, name) {
    const groups = this.getLinkGroups();
    return groups.find(g => g.some(ap => ap.season === season && ap.name === name)) || null;
  }
};

if (window.PUBLISHED_DATA) Store.loadPublishedData(window.PUBLISHED_DATA);

// ---- Small shared utilities ----

function seasonKind(id) {
  if (/^BBCAN\d+$/i.test(id)) return 'can';
  if (/^BB\d+$/i.test(id)) return 'us';
  return 'spinoff';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNum(v, decimals) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (decimals !== undefined) return v.toFixed(decimals);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

window.Store = Store;
window.seasonKind = seasonKind;
window.escapeHtml = escapeHtml;
window.formatNum = formatNum;

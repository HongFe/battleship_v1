/**
 * Persistent user profile using localStorage.
 * Stores: username, cumulative stats, hall of fame (top 10 games).
 * Test accounts (name contains "test" or is "admin") get 99999 starting gold.
 */

export interface GameStats {
  gamesPlayed: number;
  wins: number;
  totalKills: number;
  totalGold: number;
  bestWave: number;
  bestKills: number;
}

export interface HallOfFameEntry {
  name: string;
  kills: number;
  wave: number;
  gold: number;
  won: boolean;
  shipId: string;
  date: string;
}

const KEY_ID = 'bt_userId';
const KEY_NAME = 'bt_username';
const KEY_STATS = 'bt_stats';
const KEY_HALL = 'bt_hall';

/** Strip control characters and HTML-like tags from a string */
function sanitizeName(raw: string): string {
  return raw
    .replace(/[<>&"'/\\]/g, '')   // strip HTML-sensitive chars
    .replace(/[\x00-\x1F\x7F]/g, '') // strip control chars
    .trim()
    .slice(0, 20) || 'Captain';
}

class UserProfileClass {
  private cachedName: string | null = null;
  private cachedId: string | null = null;

  /** Get or create persistent user ID (UUID stored in localStorage) */
  getUserId(): string {
    if (this.cachedId) return this.cachedId;
    let id = localStorage.getItem(KEY_ID);
    if (!id) {
      // Generate UUID v4
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      localStorage.setItem(KEY_ID, id);
    }
    this.cachedId = id;
    return id;
  }

  /** Short friend code derived from user ID (6 chars, shareable) */
  getFriendCode(): string {
    const id = this.getUserId();
    return id.replace(/-/g, '').slice(0, 6).toUpperCase();
  }

  /** Get username. Prompts on first visit. */
  getName(): string {
    if (this.cachedName) return this.cachedName;
    let name = localStorage.getItem(KEY_NAME);
    if (!name) {
      name = prompt('⚓ 선장님의 이름을 입력하세요\n(Enter your captain name):') || 'Captain';
      name = sanitizeName(name);
      localStorage.setItem(KEY_NAME, name);
    }
    this.cachedName = name;
    return name;
  }

  /** Change username */
  setName(name: string): void {
    name = sanitizeName(name);
    localStorage.setItem(KEY_NAME, name);
    this.cachedName = name;
  }

  /** Is this a test/admin account? → extra starting gold */
  isTestAccount(): boolean {
    const name = this.getName().toLowerCase();
    return name.includes('test') || name === 'admin' || name === '테스트';
  }

  /** Get starting gold based on account type */
  getStartingGold(balanceDefault: number): number {
    return this.isTestAccount() ? 99999 : balanceDefault;
  }

  /** Get cumulative stats (validates shape to prevent tampered data crashes) */
  getStats(): GameStats {
    const defaults: GameStats = {
      gamesPlayed: 0, wins: 0, totalKills: 0, totalGold: 0, bestWave: 0, bestKills: 0,
    };
    try {
      const raw = localStorage.getItem(KEY_STATS);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return defaults;
      for (const key of Object.keys(defaults) as (keyof GameStats)[]) {
        if (typeof parsed[key] !== 'number' || !isFinite(parsed[key])) return defaults;
      }
      return parsed as GameStats;
    } catch {
      return defaults;
    }
  }

  /** Compute a simple rank title based on stats */
  getRankTitle(): string {
    const s = this.getStats();
    if (s.wins >= 10) return '☠ 해적왕';
    if (s.wins >= 5) return '⚓ 제독';
    if (s.totalKills >= 200) return '⚔ 함장';
    if (s.gamesPlayed >= 10) return '🚢 항해사';
    if (s.gamesPlayed >= 3) return '⛵ 수병';
    return '🛶 초보 선장';
  }

  /** Save results of a completed game */
  saveGame(data: { kills: number; wave: number; gold: number; won: boolean; shipId: string }): void {
    const stats = this.getStats();
    stats.gamesPlayed++;
    if (data.won) stats.wins++;
    stats.totalKills += data.kills;
    stats.totalGold += data.gold;
    if (data.wave > stats.bestWave) stats.bestWave = data.wave;
    if (data.kills > stats.bestKills) stats.bestKills = data.kills;
    localStorage.setItem(KEY_STATS, JSON.stringify(stats));

    // Add to hall of fame (top 10)
    const hall = this.getHallOfFame();
    hall.push({
      name: this.getName(),
      kills: data.kills,
      wave: data.wave,
      gold: data.gold,
      won: data.won,
      shipId: data.shipId,
      date: new Date().toISOString().slice(0, 10),
    });
    hall.sort((a, b) => (b.won ? 1 : 0) - (a.won ? 1 : 0) || b.wave - a.wave || b.kills - a.kills);
    if (hall.length > 10) hall.length = 10;
    localStorage.setItem(KEY_HALL, JSON.stringify(hall));
  }

  /** Get top 10 past games (validates array shape) */
  getHallOfFame(): HallOfFameEntry[] {
    try {
      const raw = localStorage.getItem(KEY_HALL);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, 10).filter(
        (e: any) => typeof e === 'object' && e !== null && typeof e.kills === 'number',
      );
    } catch {
      return [];
    }
  }

  /** Reset all data */
  reset(): void {
    localStorage.removeItem(KEY_NAME);
    localStorage.removeItem(KEY_STATS);
    localStorage.removeItem(KEY_HALL);
    this.cachedName = null;
  }
}

export const UserProfile = new UserProfileClass();

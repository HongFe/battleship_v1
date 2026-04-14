/**
 * Simple REST client for ranking API.
 * Works on internal network (same Vite server).
 * Ready for external migration — just change BASE_URL.
 */

// For internal: same origin. For external: change to full URL.
const BASE_URL = '';

export interface RankingEntry {
  userId: string;
  name: string;
  kills: number;
  wave: number;
  gold: number;
  won: boolean;
  shipId: string;
  date: string;
  score: number;
}

export const RankingAPI = {
  /** Submit game result to server ranking */
  async submitScore(data: {
    userId: string;
    name: string;
    kills: number;
    wave: number;
    gold: number;
    won: boolean;
    shipId: string;
  }): Promise<{ ok: boolean; rank: number } | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null; // server unreachable — silent fail
    }
  },

  /** Get top rankings */
  async getTopRankings(limit = 50): Promise<RankingEntry[]> {
    try {
      const res = await fetch(`${BASE_URL}/api/ranking`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.rankings ?? [];
    } catch {
      return [];
    }
  },

  /** Get a specific user's profile from server */
  async getProfile(userId: string): Promise<{ best: RankingEntry | null; totalGames: number } | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/profile/${userId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
};

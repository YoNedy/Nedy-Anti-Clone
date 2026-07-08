/**
 * Clone-account detection logic.
 *
 * Scoring system — ban threshold is configurable (default >= 5).
 *
 * Each signal is documented with its weight and rationale.
 */

export interface SuspicionReport {
  score: number;
  reasons: string[];
  verdict: "safe" | "suspicious" | "ban";
}

/** Consonants for frequency analysis */
const VOWEL_RE = /[aeiou]/gi;

/**
 * Checks for trailing-number username patterns like:
 *   ivyang15_55567  drestx77_23466  sabingtiesid15
 */
function hasTrailingNumbers(username: string): boolean {
  return /[a-z_]\d{3,}$/i.test(username);
}

/**
 * Checks for underscore-separated number suffix: word_12345
 */
function hasUnderscoreNumberSuffix(username: string): boolean {
  return /_\d{3,}$/.test(username);
}

/**
 * Checks for a run of 4+ consecutive consonants — a strong signal of a
 * randomly generated string (zpqhoemtxwkb, qrxyvakg, qqcpsrpsrrom).
 */
function hasConsonantCluster(username: string): boolean {
  return /[bcdfghjklmnpqrstvwxyz]{4,}/i.test(username);
}

/**
 * Low vowel ratio — a real name / word typically has ≥20% vowels.
 * Random strings skew heavily consonant.
 */
function hasLowVowelRatio(username: string): boolean {
  const letters = username.replace(/[^a-z]/gi, "");
  if (letters.length < 6) return false;
  const vowels = (letters.match(VOWEL_RE) ?? []).length;
  return vowels / letters.length < 0.18;
}

/**
 * Checks for repeated character pairs — qqcpsrpsrrom-style.
 */
function hasRepeatedChars(username: string): boolean {
  return /(.)\1{2,}/.test(username) || /([a-z]{2,})\1/.test(username);
}

/**
 * Returns the account age in days.
 */
function accountAgeDays(createdAt: Date): number {
  return (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
}

export function analyzeUsername(username: string): {
  score: number;
  reasons: string[];
} {
  const score_parts: { score: number; reason: string }[] = [];

  if (hasUnderscoreNumberSuffix(username)) {
    score_parts.push({
      score: 3,
      reason: `username has underscore+number suffix (${username})`,
    });
  } else if (hasTrailingNumbers(username)) {
    score_parts.push({
      score: 2,
      reason: `username ends with a long number sequence (${username})`,
    });
  }

  if (hasConsonantCluster(username)) {
    score_parts.push({
      score: 2,
      reason: `username has 4+ consecutive consonants — looks randomly generated`,
    });
  }

  if (hasLowVowelRatio(username)) {
    score_parts.push({
      score: 2,
      reason: `username has unusually low vowel ratio (${username})`,
    });
  }

  if (hasRepeatedChars(username)) {
    score_parts.push({
      score: 1,
      reason: `username has suspicious repeated character patterns`,
    });
  }

  return {
    score: score_parts.reduce((s, p) => s + p.score, 0),
    reasons: score_parts.map((p) => p.reason),
  };
}

export interface MemberProfile {
  username: string;
  hasAvatar: boolean;
  /** null means the banner fetch failed — treat as unknown, do not score */
  hasBanner: boolean | null;
  createdAt: Date;
}

/**
 * Core inspection function.
 * Pass explicit thresholds so the returned verdict always matches the
 * caller's configured action thresholds.
 */
export function inspectMember(
  profile: MemberProfile,
  banThreshold: number,
  flagThreshold: number,
): SuspicionReport {
  const reasons: string[] = [];
  let score = 0;

  // --- Avatar ---
  if (!profile.hasAvatar) {
    score += 3;
    reasons.push("no custom avatar (using default Discord avatar)");
  }

  // --- Banner (only score when status is known) ---
  if (profile.hasBanner === false) {
    score += 1;
    reasons.push("no profile banner");
  }
  // hasBanner === null → fetch failed, skip signal

  // --- Username patterns ---
  const usernameAnalysis = analyzeUsername(profile.username);
  score += usernameAnalysis.score;
  reasons.push(...usernameAnalysis.reasons);

  // --- Account age ---
  const ageDays = accountAgeDays(profile.createdAt);
  if (ageDays < 7) {
    score += 3;
    reasons.push(
      `very new account (${Math.floor(ageDays)} day${ageDays < 1 ? "" : "s"} old)`,
    );
  } else if (ageDays < 30) {
    score += 2;
    reasons.push(`new account (${Math.floor(ageDays)} days old)`);
  } else if (ageDays < 180) {
    score += 1;
    reasons.push(`relatively new account (${Math.floor(ageDays)} days old)`);
  }

  const verdict: SuspicionReport["verdict"] =
    score >= banThreshold ? "ban" : score >= flagThreshold ? "suspicious" : "safe";

  return { score, reasons, verdict };
}

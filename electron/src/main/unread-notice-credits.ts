/**
 * Every specific notification (e.g. "New email: sender: subject") also raises
 * the web app's unread count, which the shell turns into a generic
 * "You have a new notification". Each specific notification therefore covers
 * one later unread increase, so one event notifies once. Talks raises the
 * count without a specific notification, so its increases stay uncovered.
 *
 * The web app polls the unread count every 30s, so a credit has to outlive
 * one poll; it expires after that so unrelated increases still notify.
 */
export const UNREAD_CREDIT_TTL_MS = 60_000;

export class UnreadNoticeCredits {
  private credits: number[] = [];

  constructor(private readonly ttlMs = UNREAD_CREDIT_TTL_MS) {}

  /** A specific notification arrived at `now`. */
  add(now: number): void {
    this.credits.push(now);
  }

  /** How many of `added` unread items still need a generic notice. */
  uncovered(added: number, now: number): number {
    this.credits = this.credits.filter((at) => now - at < this.ttlMs);
    const covered = Math.min(added, this.credits.length);
    this.credits.splice(0, covered);
    return added - covered;
  }
}

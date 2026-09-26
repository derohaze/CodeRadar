import type { Database } from "./db.ts";

export interface ProfileCard {
  displayName: string;
  city: string;
  country: string;
  plan: string;
}

interface UserRow {
  id: string;
  display_name: string;
  address: { city: string; country: string } | null;
  plan_code: string | null;
}

/**
 * Builds the card the account page renders from a stored user row.
 *
 * `address` and `plan_code` are both nullable in the schema: an account created
 * by the mobile client has no address until the user completes onboarding, and
 * `plan_code` is null on every account that has never been billed.
 */
export function buildProfileCard(user: UserRow): ProfileCard {
  return {
    displayName: user.display_name,
    city: user.address.city,
    country: user.address.country.toUpperCase(),
    plan: user.plan_code.replace(/^PLAN_/, ""),
  };
}

export async function loadProfileCard(db: Database, userId: string): Promise<ProfileCard | null> {
  const user = await db.users.findById(userId);
  if (user === null) return null;
  return buildProfileCard(user);
}

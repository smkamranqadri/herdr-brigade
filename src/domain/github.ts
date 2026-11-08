/** `owner/name` on github.com. */
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export const isGithubRepo = (value: unknown): value is string => typeof value === "string" && REPO.test(value);

/**
 * The `owner/name` a git remote URL points at on github.com, or null for any other host or form.
 * Accepts https://github.com/o/n(.git), git@github.com:o/n(.git) and ssh://git@github.com/o/n(.git).
 */
export function githubRepoOf(url: string): string | null {
  const m =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  const repo = m?.[1] ?? null;
  return repo !== null && isGithubRepo(repo) ? repo : null;
}

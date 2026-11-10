# Writing KIS Files

Write every file in `kis/` so a person can read it quickly and act on it. These rules follow the principles of ISO 24495-1:2023 (plain language) and the sentence rules of ASD-STE100 (Simplified Technical English). They leave out the STE dictionary: code names, paths, and domain terms stay as they are.

## Relevant

- Write only what the next reader needs to recover or act.
- Write for a person who has not seen the conversation.
- Leave out history, process, and reasoning that no longer matters.

## Findable

- Put the answer first, then the detail.
- Use headings that say what is under them.
- Keep one topic per section, and at most six sentences per paragraph.
- Use a list for three or more parallel items, and a table to compare.

## Understandable

- Keep a sentence to 20 words for an instruction and 25 for a description.
- Give one instruction per sentence.
- Use the active voice, so the sentence says who does what.
- Use one term for one thing, and the same term every time. Name things the way the code does.
- Use the simple present, past, or future tense.
- Keep a noun cluster to three words. Break a longer one with "of" or a clause.
- Use common words. Define a term the first time if a newcomer would not know it.
- Write full sentences with their articles and verbs. Only labeled lines, such as `Task:`, may be fragments.

## Usable

- Write each step as a command: what to do, then how to check it.
- Give the exact command, path, or value, not a description of it.
- Put a warning before the step it applies to.
- Read what you wrote as the next reader. If a sentence needs the conversation to make sense, rewrite it.

## Example

```text
Before: Investigation into the token refresh failure handling was done, and it was
determined that the retry logic configuration was the likely cause of the issue.

After:  Token refresh fails because the retry limit is 0.
        Next: set `RETRY_LIMIT=3` in `auth/config.ts`, then run `npm test`.
```

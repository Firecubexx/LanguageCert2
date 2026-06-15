# SELT Mastery

## Start the website

1. Revoke any Groq key that has been pasted into chat or shared publicly.
2. Create a new key at `https://console.groq.com/keys`.
3. Open `.env` and add the new key after `GROQ_API_KEY=`.
4. Run `start-selt.ps1` in PowerShell.
5. Open `http://127.0.0.1:8765/selt-practice-platform.html`.

The API key stays in the local backend and is never sent to the browser source.

## AI evaluation

- Writing is evaluated for task achievement, organisation, grammar, vocabulary, and register/mechanics.
- Speaking is recorded in the browser, transcribed by Groq, and evaluated from the transcript.
- Pronunciation is not scored because transcript-only assessment cannot measure it reliably.
- Every AI score is a practice estimate, not an official LANGUAGECERT result.

## Full mocks

The dashboard contains eight fixed mock papers. Each has 30 Listening questions, 30 Reading questions, two Writing tasks, and four Speaking parts.

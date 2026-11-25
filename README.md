# Intelligent Interactive Systems A2 Project

Prose word count: 814

An AI study chat where the student sets their own study rule, such as "Hints only", and the tutor's replies are checked against it before they are shown.

## Project Status

Works:

- Chat with a tutor model, with maths rendered.
- A study rule and a number of allowed full answers (0 to 5).
- A response checker that has a reply rewritten, up to twice, when it gives the answer away or breaks the rule, and replaces it with "I can't answer that without breaking your study rule." if both rewrites fail.
- A note on rewritten replies, with the answer values hidden and "Was this rewrite right?".
- "Use an answer" in the + menu, which shows the full answer.
- Copy, thumbs up/down, regenerate and chat titles.

Simulated:

- Uploading a question set.
- Sets 1 and 2 show as if uploaded before under 'Recent files'.

Unfinished:

- Written answers are checked by the AI alone, with no code check.
- "Was this rewrite right?" answers are logged but not acted upon since that is out of scope.
- Chats are lost when the server stops.
- Not tested with real students.

## Tech stack

- Python: the server, the study rule and answer count, the reply checks and the log.
- HTML, CSS and JavaScript: the chat page, with KaTeX for maths and the Atkinson Hyperlegible font, both loaded from CDNs.
- Groq API, free tier: `gpt-oss-120b` writes and rewrites replies; `gpt-oss-20b` checks replies and writes chat titles.

## Running the prototype

Needs Python 3.9 or later and an internet connection.

1. Get a free API key at [console.groq.com](https://console.groq.com).
2. Create `.env` in the repository's root with:

```
GROQ_API_KEY=your-key-here
```

3. Run the server and open http://localhost:8000:

```
python3 app.py
```

To try it, open the + menu, choose Study rule, enter a rule such as "Hints only" and press Start. Then attach a question set from Add files and work through one of its questions.

To try the upload, choose Upload from computer under Add files and pick `sample-files/cvi-mock-set-3.md`.

For testing, `python3 app.py --checker off` shows the tutor's replies unchanged. Every check is logged to `logs/checks.jsonl`.

## Development record

| Stage | What changed and why | Checked | Commits |
| --- | --- | --- | --- |
| Setup | Three mock question sets with answer keys, a Python server and chat page started with a single command, and live replies from Groq's free tier. | Compared free providers such as Groq, Gemini, and OpenRouter, and checked that it runs from a fresh clone. | [901053a](https://github.com/0H77/iis-a2/commit/901053a), [e337dc5](https://github.com/0H77/iis-a2/commit/e337dc5), [eecd074](https://github.com/0H77/iis-a2/commit/eecd074) |
| Rule and checker | Replies are checked before display, as set out in the design (see the report). The rule is set from the + menu and locked at the first message. The check was extended from answers to the rule's own wording after a strict rule was not enforced. Calculation answers are compared by quantity, because matching numbers alone missed answer values that also appear in the question. | Tested manually with repeated requests for the answer. The strict rule was rerun after the change. Replies from earlier sessions were rechecked with the new check before it replaced the old one. | [03fdb4f](https://github.com/0H77/iis-a2/commit/03fdb4f), [f78ac8d](https://github.com/0H77/iis-a2/commit/f78ac8d), [4264870](https://github.com/0H77/iis-a2/commit/4264870) |
| The chat interface | Question sets are attached as files in the chat. Rewritten replies carry a note explaining the change, with the answer values hidden, and ask whether the rewrite was right. Replies have copy, rating and regenerate buttons. Formatting and scrolling were corrected. Button feedback, motion and chat titles make it feel like a real chat app. Using an answer now asks for confirmation, and full answers were given a higher length limit after one was cut off. | Rewrite notes inspected to confirm that no answer values are shown. Compared formatting and scrolling before and after each fix. | [39b1dcf](https://github.com/0H77/iis-a2/commit/39b1dcf), [efbce87](https://github.com/0H77/iis-a2/commit/efbce87), [751088d](https://github.com/0H77/iis-a2/commit/751088d), [09d0872](https://github.com/0H77/iis-a2/commit/09d0872), [d7aa27a](https://github.com/0H77/iis-a2/commit/d7aa27a), [50130b8](https://github.com/0H77/iis-a2/commit/50130b8), [4590ead](https://github.com/0H77/iis-a2/commit/4590ead) |
| Testing | A switch disables the checker and every check is logged, so that sessions can be compared. | Ran with the checker off and verified log output. | [009dd26](https://github.com/0H77/iis-a2/commit/009dd26) |

## AI assistance

- **Claude (chat):** planning, comparing providers, and designing figures.
- **Claude Code:** most of the code.

The decisions were my own, output was reviewed before it was committed, and the app was tested through use. Claude Code ran the scripted tests and replays, and the results were reviewed. Examples of its output being changed:

- A separate question picker was proposed and I replaced it with question sets attached as files in the chat.
- Rejected a dropdown design proposal for the rule, a banner when the answer limit is reached, and offering the answer after the student pushes back since that contradicted the project's premise.
- Claude proposed a button to reveal the LLM's first draft. I removed it because it was a way around the rule.
- Claude proposed 5 practice questions. I required 3 sets of 15 covering every topic examined in past CVI papers, with numeric answers computed by code so the keys are deterministic.

## Other files

- `questions/question_sets.json`: the three question sets with answer keys.
- `sample-files/cvi-mock-set-3.md`: set 3 without answers, for trying the upload feature.

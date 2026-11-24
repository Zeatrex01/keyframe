# Language rule

**Everything in this repository is English**, with exactly two exceptions:

1. `locale/tr.json` — the optional Turkish UI catalog, in parity with `locale/en.json`. The page
   starts in English; Turkish is chosen in Settings or the language switch.
2. `src/shared/legacy-names.js` — the legacy names old projects still carry (backup roots,
   the reference folder, delivery markers). The reader accepts them; the writer never emits
   them. Every other module imports them from there instead of spelling them.

Why: agents read code, tool descriptions and docs. English costs roughly a third fewer tokens
than Turkish for the same content, and the audience of a public tool shares English. The
earlier tree grew hundreds of Turkish identifiers and tool arguments because the rule came
late; here it is a gate from the first commit.

Decisions recorded in `docs/` are written as product rationale in English, never as quotes of a
person.

**The gate:** `test/language.test.js` fails on any Turkish letter, or any word from
`test/language-words.txt`, in code, tool definitions, pages, examples and tests, and on any
Turkish letter in a Markdown document. Whatever language a user chats in, nothing said in chat is
copied into code as a name.

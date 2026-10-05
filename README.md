# double-bang

A Claude Code mod that adds `!!`: run a shell command from the prompt without sharing it with Claude.

Claude Code's `!` runs a command and puts the command and its whole output in the conversation, where it costs tokens on every later turn. `!!` runs it the same way, but the conversation keeps only two short placeholders, `(private shell command)` and `(output withheld)`. The real output stays in a band above the prompt, with a **Share with Claude** button for when you do want Claude to see it.

## Usage

- `!!<command>`: type `!` (switches to shell mode), then `!` again, then the command. The status line shows `!! private` once armed.
- **Share with Claude** in the band, or `/bang-share`: adds the last `!!` command and its output to the conversation as a note Claude reads with your next message. Sharing starts no turn by itself. Prefer the button: a slash command's own output line also reaches Claude.
- **Dismiss** hides the band; **More** shows up to 200 lines.

Backspacing out of shell mode, or sending a normal prompt, clears the private mark.

## Install

Requires Claude Code 2.1.287 or later.

```
claude plugin marketplace add lucasbertoni/double-bang
claude plugin install double-bang@double-bang
```

To try it from a clone without installing: `claude --plugin-dir <path to clone>`.

## Limits

- Claude can tell a private command ran (the two placeholders, about 10 tokens), but not what it was or what it printed.
- The output band draws in the terminal and the Desktop Code tab only.

## Development

```
claude plugin validate .
claude plugin test .
```

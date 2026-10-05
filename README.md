# double-bang

A Claude Code mod that adds a sidecar terminal: a pane where you run shell commands outside the conversation.

Claude Code's `!` runs a command and puts the command and its whole output in the conversation, where it costs tokens on every later turn. The sidecar runs commands in a process of its own, so neither the command nor its output reaches Claude. When you do want Claude to see a run, **Share with Claude** sends it along with your next message.

## Usage

- The pane opens by itself when a session starts in a terminal at least 144 columns wide. Anywhere else, `/sidecar` opens it (the slash command leaves a small trace in the conversation, once).
- Type a command in the pane's field and press Enter. Output streams into the pane with the exit code.
- `cd` works: later commands start in the folder it landed in.
- **Stop** ends a running command; **Share with Claude** queues a finished run (command, folder, exit code, output) to go with your next message, as context Claude reads beside it; **Don't share** takes it back off the queue. Sharing starts no turn by itself.
- **Clear** empties the pane.
- The message that carried a run shows it underneath, one line each (`⇡ shared $ git status  ok, 14 lines · ctrl+o to expand`); ctrl+o shows the run whole, with its folder and output.

Commands run in the shell Claude Code's own `!` uses: Git Bash on Windows (found via `CLAUDE_CODE_GIT_BASH_PATH`, then the standard install, then beside `git.exe`; PowerShell if there is none), bash elsewhere.

## Install

Requires Claude Code 2.1.287 or later.

```
claude plugin marketplace add lucasbertoni/double-bang
claude plugin install double-bang@double-bang
```

To try it from a clone without installing: `claude --plugin-dir <path to clone>`.

## Limits

- Commands run once and report what they printed: no interactive programs (`vim`, `ssh`, prompts that wait for input).
- Each command runs in a fresh shell, so variables and aliases set in one run do not carry to the next; only the folder from `cd` does.
- The pane runs commands from the terminal and the Desktop Code tab only.

## Development

```
claude plugin validate .
claude plugin test .
```

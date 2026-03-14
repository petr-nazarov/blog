---
title: "Dotfile Management and Terminal power tools"
description: "A practical guide to modern terminal tools, dotfile management, and workflow automation that will make your command-line experience significantly more productive."
date: 2026-03-14
tags: ["terminal", "dotfiles", "linux", "devops", "cli-tools"]
---


This is a summary of a talk about dotfiles and terminal tools.
You can see examples in my [dotfiles](https://github.com/petr-nazarov/dotfiles) and [infrastructure](https://github.com/petr-nazarov/infrastructure).

## Modern Drop-in Replacements for Classic Unix Tools

Several modern tools serve as superior replacements for classic Unix commands. They're typically written in Rust, faster, and have better defaults.

### `eza` instead of `ls`

[eza](https://github.com/eza-community/eza) is a drop-in replacement for `ls` with color-coding, icons, and sensible defaults:

```bash
alias ls="eza --icons --group-directories-first -la"
```

### `bat` instead of `cat`

[bat](https://github.com/sharkdp/bat) adds syntax highlighting, line numbers, and paging (it replaces both `cat` and `less`):

```bash
alias cat="bat"
```

### `fd` instead of `find`

[fd](https://github.com/sharkdp/fd) is a simpler, faster alternative to `find`:

```bash
# Classic find:
find . -name "*.py" -type f

# fd equivalent:
fd -e py
```

### `ripgrep` (`rg`) instead of `grep`

[ripgrep](https://github.com/BurntSushi/ripgrep) is significantly faster, respects `.gitignore`, and has better defaults.

### `delta` instead of `git diff`

[delta](https://github.com/dandavison/delta) provides beautiful, side-by-side diffs with syntax highlighting. Set it up in your `~/.gitconfig`:

```ini
[core]
    pager = delta

[interactive]
    diffFilter = delta --color-only
```

### `jq` for JSON

[jq](https://github.com/jqlang/jq) is a command-line JSON processor. Pipe any JSON into it for pretty-printing and filtering:

```bash
# Pretty-print a minified JSON file
cat tsconfig.json | jq

# Extract a specific field
cat tsconfig.json | jq '.compilerOptions.target'

# Filter arrays, transform data
curl -s https://api.example.com/data | jq '.results[] | {name, id}'
```

## fzf: The Swiss Army Knife of Fuzzy Finding

[fzf](https://github.com/junegunn/fzf) is a general-purpose fuzzy finder. It takes any list of strings as input via pipe and provides an interactive selection interface. The selected item is then piped to the next command.

### Basic usage

```bash
# Pipe anything into fzf
echo -e "alpha\nbeta\ngamma" | fzf

# Use the selected value
echo -e "alpha\nbeta\ngamma" | fzf | wc -w
```

### Interactive git branch switching

```bash
# Add to your .zshrc
gco() {
  git branch | fzf | xargs git checkout
}
```

### Fuzzy history search

fzf integrates with shell history out of the box (typically bound to `Ctrl+R`). Your `~/.zsh_history` is just a text file -- fzf makes it searchable:

```bash
cat ~/.zsh_history | fzf
```

### Fuzzy tmux session selector

```bash
tt() {
  tmuxinator list | tail -n +2 | fzf | xargs tmuxinator start
}
```

fzf can be piped into GUI launchers too. On Linux, tools like [walker](https://github.com/abenz1267/walker) or `dmenu` work the same way -- they accept piped input and output the selection. On macOS, [choose-gui](https://github.com/chipsenkbeil/choose) serves the same purpose.

## lazygit and lazydocker

[lazygit](https://github.com/jesseduffield/lazygit) is a full-featured terminal UI for git. You can browse commits, stage/unstage files, stash, cherry-pick, switch branches -- all via keyboard shortcuts. Press `?` to see all keybindings.

[lazydocker](https://github.com/jesseduffield/lazydocker) is the same concept for Docker. View running containers, inspect logs, exec into containers, restart services, check stats -- all from a terminal UI.

Both ship as single binaries, making them easy to install even on remote machines.

```bash
alias lg="lazygit"
alias lzd="lazydocker"
```

## Dotfile Management with GNU Stow

[GNU Stow](https://www.gnu.org/software/stow/) manages your dotfiles by creating symlinks. The idea: keep all your config files in a git repository (e.g., `~/dotfiles/`) that mirrors your home directory structure, and stow creates the symlinks for you.

```
~/dotfiles/
  _common/
    .zshrc
    .ssh/config
    .config/
      alacritty/alacritty.toml
      ...
  _linux/
    .config/
      hyprland/...
  _mac/
    ...
```

Running stow symlinks everything into your home directory:

```bash
stow  -t "$HOME" _common
stow -t "$HOME" _linux # or mac
```

Your `.zshrc` in `~` becomes a symlink to `~/dotfiles/_common/.zshrc`. Now all configs are version-controlled. You can split configs into `common`, `linux`, and `mac` directories for platform-specific settings.

You can also keep your `.zshrc` clean by splitting it into multiple sourced files:

```bash
# ~/.zshrc
source ~/.config/zsh/settings.zsh
source ~/.config/zsh/aliases.zsh
source ~/.config/zsh/variables.zsh
source ~/.config/zsh/plugins.zsh
source ~/.config/zsh/secrets.zsh
```

## just: A Modern Task Runner

[just](https://github.com/casey/just) is a command runner inspired by `make`, but without Makefile's quirks (where every indent is significant and targets are expected to produce files). It's essentially a simpler, more readable Makefile.

```justfile
# Justfile
init:
  pre-commit install

[linux]
sync:
  stow  -t "$HOME" _common
  stow -t "$HOME" _linux
[macos]
sync:
  stow  -t "$HOME" _common
  stow -t "$HOME" _mac


[linux]
unsync:
  stow  -D -t "$HOME" _common
  stow  -D -t "$HOME" _linux

[macos]
unsync:
  stow  -D -t "$HOME" _common
  stow -D -t "$HOME" _mac
```

```bash
just sync       # "just sync" -- reads like English
```

It supports variables, dependencies between tasks, OS-specific recipes, and parameters.

## mise: Universal Version Manager

[mise](https://mise.jdx.dev/) (from French "mise en place") is a polyglot version manager that replaces pyenv, nvm, fnm, rbenv, and similar tools. One tool to manage versions of Python, Node.js, Go, Terraform, and [hundreds more](https://mise-versions.jdx.dev/).

Create a `mise.toml` in your project root:

```toml
[tools]
python = "3.12"
node = "lts"
pnpm = "latest"
```

Then:

```bash
mise install
```

The key feature: **per-directory tool versions**. When you `cd` into a project, mise activates the correct versions. A different project can use different versions of the same tools.

```bash
# In project-a/ -- Python 3.12, Node 20
cd project-a && which python
# ~/.local/share/mise/installs/python/3.12.0/bin/python

# In project-b/ -- Python 3.11, Node 18
cd project-b && which python
# ~/.local/share/mise/installs/python/3.11.0/bin/python
```

You can also set global tool versions:

```toml
# ~/.config/mise/config.toml
[tools]
python = "latest"
node = "lts"
go = "latest"
fzf = "latest"
fd = "latest"
ripgrep = "latest"
```

Think of it as a universal virtualenv/conda for all programming languages and CLI tools.

## tmuxinator: Predefined tmux Layouts

[tmuxinator](https://github.com/tmuxinator/tmuxinator) lets you define tmux session layouts in YAML files. Instead of manually splitting panes every time, define your workspace once:

```yaml
# ~/.config/tmuxinator/myproject.yml
name: myproject
root: ~/Projects/myproject

windows:
  - editor:
      layout: main-horizontal
      panes:
        - nvim
        - ''  # empty terminal
  - server:
      panes:
        - npm run dev
  - logs:
      panes:
        - tail -f logs/app.log
```

```bash
tmuxinator start myproject
tmuxinator stop myproject
```

## yazi: Terminal File Manager

[yazi](https://github.com/sxyazi/yazi) is a fast terminal file manager with tabs, file previews (including images), and vim-like keybindings.

## System Setup with Ansible

[Ansible](https://docs.ansible.com/) is a configuration management tool that lets you declaratively describe the desired state of a system. Instead of writing imperative scripts ("run this command, then that command"), you describe **what** the system should look like.

You can use it to set up your personal machines from scratch with a single command:

```yaml
# roles/base/tasks/main.yml
- name: Install base packages
  package:
    name:
      - git
      - neovim
      - tmux
      - zsh
    state: present

- name: Install AUR packages
  aur:
    name:
      - lazygit
      - lazydocker
      - eza
      - bat
    state: present
```

Organize your setup into roles (base, desktop, gaming, docker, etc.) and hosts (desktop, laptop, server):

```yaml
# playbook.yml
- hosts: workstations
  roles:
    - base
    - dotfiles
    - desktop

- hosts: desktop
  roles:
    - gaming
    - wake-on-lan
```

Deploy everything with one command:

```bash
just deploy desktop
# runs: ansible-playbook playbook.yml --limit desktop
```

Ansible has modules for almost anything: package managers, Docker, Cisco switches, OpenWRT routers, systemd services, file templates, and more.

### Managing Secrets with SOPS

[SOPS](https://github.com/getsops/sops) (Secrets OPerationS) encrypts only the **values** in your YAML/JSON files, leaving keys visible. This means your secrets file can live in a public git repository:

```yaml
# What everyone sees in git (encrypted):
db_password: ENC[AES256_GCM,data:abc123...,type:str]
api_token: ENC[AES256_GCM,data:def456...,type:str]

# What you see after: sops secrets.yml
db_password: my-actual-password
api_token: my-actual-token
```

SOPS integrates with Ansible's Jinja2 templates. You can write Docker Compose files as templates with `{{ variable }}` placeholders that get filled from your encrypted secrets at deploy time.

## Syncthing: Peer-to-Peer File Sync

[Syncthing](https://syncthing.net/) synchronizes files between devices without any cloud service. It's peer-to-peer, free, and encrypted.

Use case: sync notes, papers, or any folder across your desktop, laptop, phone, and home server. Whenever a device comes online, it syncs with the others automatically.

```
Desktop <---> Home Server <---> Laptop
    \                              /
     +-------> Phone <-----------+
```

Adding a new device is as simple as scanning a QR code. Your data stays on your devices -- no third-party storage involved.

## rsync over scp

Prefer `rsync` over `scp` for file transfers. `scp` re-transfers everything from scratch every time. `rsync` only sends the differences:

```bash
rsync -avz --delete ./dist/ user@server:/var/www/html/
```

- `-a`: archive mode (preserves permissions, timestamps, etc.)
- `-v`: verbose
- `-z`: compress during transfer
- `--delete`: remove files on the destination that don't exist locally

This matters when you're on a slow connection or transferring large directories.

## Essential Terminal Shortcuts

When you can't install any tools (locked-down environments, restricted servers), these built-in shortcuts still work:

| Shortcut | Action |
|----------|--------|
| `fg` | Bring suspended process back to foreground |
| `bg` | Continue suspended process in background |
| `!!` | Repeat last command (useful with `sudo !!`) |
| `!$` | Last argument of previous command |
| `^old^new` | Re-run last command, replacing `old` with `new` |

The `!$` trick is handy for sequences like:

```bash
mkdir -p /some/deep/path
cd !$
# expands to: cd /some/deep/path
```

And `^old^new` for fixing typos:

```bash
grep -r "patern" src/
# typo! fix it:
^patern^pattern
# runs: grep -r "pattern" src/
```


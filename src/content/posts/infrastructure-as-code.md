---
title: "Infrastructure as Code, End to End: Provisioning with Pulumi and Configuring with Ansible"
description: "An opinionated, full IaC stack: provisioning machines with Pulumi (and Terraform/OpenTofu), configuring them with Ansible, keeping secrets in a public repo with SOPS, deploying workloads via Docker Swarm + Jinja2, and smoothing it all out with just and Dagger."
date: 2026-06-10
tags: ["iac", "pulumi", "terraform", "ansible", "sops", "docker", "devops"]
---


Almost nobody racks their own servers anymore. Labeling machines by hand, walking into a cold room to find the one that's blinking red — that's mostly gone, replaced by the cloud, where a server is something you ask for over an API. (Even plenty of "private" clouds are really just a hypervisor like [Proxmox](https://www.proxmox.com/) underneath, handing you VMs on demand.)

Once a server is just an API call away, though, you run into a different problem. How do you write that server down somewhere, so you can recreate it, review changes to it, and trust that the thing you describe is the thing you get? That question is the entire reason Infrastructure as Code exists. You describe your infrastructure in code, commit it to git, and when you need a second environment you copy the config, swap `dev` for `prod`, and run it again.

I want to walk through a full stack here — the one I actually use:

- Provisioning the machines (Terraform / OpenTofu / Pulumi)
- Configuring what runs on them (Ansible)
- Keeping secrets safe even in a public repo (SOPS)
- Deploying real workloads (Docker Swarm + Jinja2)
- And two smaller tools, Dagger and just, that make the day-to-day a lot nicer.

---

## Provisioning: Terraform, OpenTofu, and Pulumi

### Terraform and the OpenTofu fork

The obvious starting point is [Terraform](https://developer.hashicorp.com/terraform), from [HashiCorp](https://www.hashicorp.com/). It's the tool most people mean when they say IaC, and it's genuinely good at declaring cloud resources.

Terraform is declarative. You describe the end state you want, and it works out the order to build things by following the references between resources. Where you put a resource in the file doesn't matter. If resource B points at resource A, Terraform builds A first regardless.

Here's the classic first example: declare a provider, create an S3 bucket. (A "bucket" is just [object storage](https://aws.amazon.com/s3/) — somewhere to dump files.)

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-central-1"
}

resource "aws_s3_bucket" "data" {
  bucket = "my-app-data-bucket"
}
```

One bit of recent history is worth knowing before you commit. In 2023 HashiCorp [relicensed Terraform](https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license) from the open-source MPL to the [Business Source License](https://opensource.org/blog/the-business-source-license-is-not-open-source). A lot of people were unhappy about it, and the community responded with [OpenTofu](https://opentofu.org/), a fully open fork that now lives under the Linux Foundation. If you care about staying on something that can't be relicensed out from under you, OpenTofu is a drop-in swap.

### The catch: HCL is its own language

The thing that always grated on me about Terraform is that it has its own language, [HCL](https://github.com/hashicorp/hcl). It isn't hard to pick up, but it's one more language living in your head, and it starts to fight you the moment you want to do anything dynamic. Spin up N copies of something in a loop and suddenly you're wrangling maps and `for_each` blocks, and it stops feeling natural fast.

### Pulumi: write infrastructure in a real language

[Pulumi](https://www.pulumi.com/) exists to solve exactly that. Instead of HCL, you describe your resources in a real programming language — TypeScript, Python, Go, C#, Java, or plain YAML if you want. Work in C#? Write your infra in C#. Loops, conditionals, functions, and the autocomplete you already rely on all work the way you'd expect.

>  Pulumi has its own engine and its own state model, separate from Terraform — it's a separate tool. But Pulumi can borrow Terraform's whole provider ecosystem through the [provider bridge](https://www.pulumi.com/docs/iac/using-pulumi/extending-pulumi/), which is why providers like Hetzner's just work from day one.

For the examples I'll use [Hetzner Cloud](https://www.hetzner.com/cloud/). It's a German host with good prices and, more usefully for a tutorial, a small set of resources you can actually hold in your head. On Google Cloud or AWS, getting "one working VM" pulls in instance groups, networks, backends, load balancers, zone rules, and a pile of other things. That's a whole course on its own. Hetzner gets out of the way so we can talk about the ideas.

### Provisioning a server

The core idea looks like this. With Pulumi and the [`@pulumi/hcloud`](https://www.pulumi.com/registry/packages/hcloud/) provider, you import the SDK and declare a server as an object:

```typescript
import * as hcloud from "@pulumi/hcloud";

const node1 = new hcloud.Server("node-1", {
    image: "debian-12",
    serverType: "cx32",   // 4 vCPU, 8 GB RAM, 160 GB disk, 20 TB traffic
    location: "hel1",      // Helsinki
    publicNets: [{
        ipv4Enabled: true,
        ipv6Enabled: true,
    }],
});

export const ipv4 = node1.ipv4Address;
```

That's pretty much all provisioning is. Everything you'd otherwise click through in a web console — Create resource, Server, 4 cores / 8 GB, Helsinki, Debian 12 — is now in a file you can read and diff. Then you run:

```bash
pulumi up
```

Pulumi reads the file, calls the Hetzner API, and a minute later you've got a real VM with Debian 12 on it. When you're done, `pulumi destroy` tears it down.

You can run this from your laptop, but it's much nicer from CI/CD. For example: a test run kicks off, CI runs `pulumi up` against the test config, waits for the box to come up, then it opens an SSH connection to the created machine, pulls the repo or a Docker image, runs the suite, and then `pulumi destroy`s everything so nothing sits there costing money while idle.

### Wiring up the extras: floating IPs, the dependency graph, and `apply`

Real servers need more than a bare instance — a static IP, a volume, an SSH key. This is where Pulumi's relationship to the dependency graph becomes visible. Say you want a [floating IP](https://docs.hetzner.com/cloud/floating-ips/overview/) attached to your node:

```typescript
const masterIp = new hcloud.FloatingIp("master-ip", {
    type: "ipv4",
    homeLocation: "hel1",
});

const assignment = new hcloud.FloatingIpAssignment("master-ip-assignment", {
    floatingIpId: masterIp.id.apply(id => parseInt(id)),
    serverId: node1.id.apply(id => parseInt(id)),
});
```

Look at `node1.id.apply(...)`. When your code runs locally, the server doesn't exist yet. It has no ID in Hetzner's system, because so far it's just code sitting on your machine. So you can't read `node1.id` as a plain number. Pulumi hands you an [`Output<T>`](https://www.pulumi.com/docs/concepts/inputs-outputs/) instead, with a small functional API: `.apply()` means "once the server actually exists, take its ID and do this with it." It's the dependency graph again, just expressed in your own language.

SSH keys are worth a quick mention too. Hetzner, like most providers, manages keys at the provider level rather than per-machine — it writes your public key into the right place on the VM for you. You load a key from a file and attach it the same way you attached the floating IP.

### Environments via config / stacks

Both Terraform and Pulumi give you per-environment config files. Pulumi calls them [stacks](https://www.pulumi.com/docs/concepts/stack/). You keep a `Pulumi.dev.yaml` and a `Pulumi.prod.yaml`, each with its own values — different passwords, different instance counts — alongside a base `Pulumi.yaml`.

```typescript
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const instanceCount = config.requireNumber("instanceCount");
```

So prod might run five instances and dev just one, and switching between them is a matter of picking the stack:

```bash
pulumi stack select dev
pulumi up   # reads values from Pulumi.dev.yaml
```

---

## The line between provisioning and configuration

Here's the mental model that took me a while to internalize. `pulumi up` gives you a bare machine. It might not even have your Linux user yet, and it definitely doesn't have the right Node or Python versions, your dependencies, a compiler, GPU drivers, or anything else your app actually needs.

Pulumi can technically reach into that gap. There's a [`command`](https://www.pulumi.com/registry/packages/command/) provider that copies files and runs commands over SSH:

```typescript
import * as command from "@pulumi/command";

const copyScript = new command.remote.CopyToRemote("copy-script", {
    connection: { host: node1.ipv4Address, user: "root", privateKey: sshKey },
    source: new pulumi.asset.FileAsset("./setup.sh"),
    remotePath: "/root/setup.sh",
});

const runScript = new command.remote.Command("run-script", {
    connection: { host: node1.ipv4Address, user: "root", privateKey: sshKey },
    create: "chmod +x /root/setup.sh && /root/setup.sh",
}, { dependsOn: copyScript });
```

You can live this way. I've deployed a few servers like this. It's miserable, and the reason it's miserable is that it's imperative, not declarative.

### Declarative vs. imperative, quickly

- Imperative is *how*: do A, then B, then C. Every shell or SSH script is imperative.
- Declarative is *what*: "this user exists on the machine." You state the end state and let the tool get there.

The trouble with imperative scripts is that they aren't idempotent unless you do a lot of extra work to make them so. Picture a script that creates a user, logs in as them, and installs Node. Run it a second time and it falls over on the first step: that user already exists. A declarative system sidesteps the whole problem by describing the destination — "there should be a user named X" — and converging to it no matter where it started. Pulumi and Terraform do this for provisioning. For configuring the machine itself, the tool is Ansible.

---

## Configuration: Ansible

[Ansible](https://docs.ansible.com/) has been around for over a decade, and it's built to declaratively describe the state of a machine that already exists. You write it in YAML.

To put a number on why I care: my entire daily workstation is configured in Ansible. If I wiped it this afternoon, I'd install Arch, log in, clone my Ansible repo, run `apply`, and roughly ten to fifteen minutes later — most of that just downloading packages — I'd be back to my exact setup. Terminal, fonts, window manager, browser, everything. The one thing I've never managed to fully automate is logging back into web apps. (Firefox at least [supports policy-based config](https://mozilla.github.io/policy-templates/) for some of that.)


### The Ansible vocabulary

There's some terminology to learn. The main pieces:

**Inventory** is the list of machines you act on. Ansible can run against `localhost` to configure the box you're sitting at, or against remote hosts over SSH. You sort hosts into groups:

```ini
[workstations]
home-desktop
matebook

[home-servers]
home-media
home-edge

[docker-swarm-managers]
home-edge
```

Grouping lets you target a whole set at once: `--limit workstations` hits both the desktop and the laptop.

**Host and group vars** are per-host variables. Different machines might log in as different users, or use a different Python interpreter, or have a different root password:

```yaml
ansible_host: 10.0.0.5
ansible_user: example
ansible_become_password: "{{ vault_root_password }}"
ansible_python_interpreter: /usr/bin/python3
```

**Tasks** are the smallest unit of work. Each task uses a **module** to enforce some piece of state. Here's one that makes sure a set of base packages is installed, using the [`community.general.pacman`](https://docs.ansible.com/ansible/latest/collections/community/general/pacman_module.html) module on Arch:

```yaml
- name: Install base packages
  become: true
  community.general.pacman:
    name: "{{ base_packages }}"
    state: present
```

The package list lives in a vars file:

```yaml
base_packages:
  - git
  - rsync
  - github-cli
```

The `state` parameter is the declarative heart of the whole thing. It takes `present`, `installed`, `latest`, `absent`, or `removed`. So when a CVE lands in some Node version, you flip the relevant entry to `absent` and run it across every server: "make sure this is *not* here," and Ansible removes it wherever it turns up.

**Modules** are the pre-written building blocks — `pacman` is one of many. You almost never write the install/update/remove logic yourself; that's the module's job. It's all Python underneath, since Ansible is a Python tool, and you pull in extra collections through `requirements.yml`:

```yaml
collections:
  - name: community.general
  - name: community.sops
  - name: community.docker
```

**Roles** bundle tasks, plus their own vars and templates, into reusable units. Playbooks can group tasks too, but roles slice more cleanly when you only want part of a playbook. A role's `tasks/main.yml` just pulls its tasks together:

```yaml
- import_tasks: ensure-base-devel.yml
- import_tasks: install-yay.yml
- import_tasks: install-terminal-packages.yml
```

A concrete example. Installing [`yay`](https://github.com/Jguer/yay) — a broader [AUR](https://aur.archlinux.org/) helper than plain `pacman` — is fiddlier than it should be. `yay` insists on prompting for a sudo password interactively and won't take it as a flag, so the role spins up a dedicated builder user with passwordless sudo, installs `git` and `base-devel`, clones the repo, and runs the build:

```yaml
- name: Install build dependencies
  become: true
  community.general.pacman:
    name:
      - git
      - base-devel
    state: present

- name: Create passwordless build user
  become: true
  ansible.builtin.user:
    name: aur_builder
    create_home: true
    group: wheel

- name: Allow aur_builder passwordless sudo for pacman
  become: true
  ansible.builtin.copy:
    content: "aur_builder ALL=(ALL) NOPASSWD: /usr/bin/pacman\n"
    dest: /etc/sudoers.d/aur_builder
    validate: visudo -cf %s

- name: Clone and build yay
  become: true
  become_user: aur_builder
  ansible.builtin.shell: |
    cd /tmp && git clone https://aur.archlinux.org/yay.git
    cd yay && makepkg -si --noconfirm
  args:
    creates: /usr/bin/yay
```

The top-level `main.yml` then assembles roles per host group:

```yaml
- name: Configure workstations
  hosts: workstations
  vars:
    ansible_python_interpreter: /usr/bin/python3
  roles:
    - arch-base
    - arch-terminal
    - linux-dev-env
    - hyprland
    - arch-gui-apps
```

My own roles cover things like `linux-dev-env` (installs [mise](https://mise.jdx.dev/) to manage Rust/Go/Python/Node versions, sets `zsh` as the default shell, applies my tmux config through TPM, even installs Claude), `hyprland` (the full [Hyprland](https://hyprland.org/) desktop — panel, gestures, rotating wallpapers), and `arch-gaming` (AMD drivers like Mesa and Vulkan Radeon, Steam, Lutris, a low-latency kernel, wake-on-LAN, hibernation). The Debian versions are much shorter, with one exception: installing Docker, which is a pain on every OS.

There's also `linux-ssh`, a hardening role I'll call out specifically. It makes sure my public key is in place and then turns off password-based SSH entirely. After it runs, even somebody holding the root password can't log in over SSH. Key only.

---

## Secrets in a public repo, with SOPS

Here's a trick I'm fond of. My infrastructure repo is [public](https://github.com/petr-nazarov/infrastructure) on GitHub, and it contains my Cloudflare API tokens, root passwords, the lot. Why isn't that a disaster?

[SOPS](https://github.com/getsops/sops) — Secrets OPerationS. It encrypts the *values* in your config while leaving the structure readable: keys, layout, comments all stay in the clear. Open my `vars/docker_swarm.sops.yml` on GitHub and you'll see every variable name — `cloudflare_api_token`, internal IPs, root passwords — but each value is ciphertext. Edit the file locally and SOPS quietly decrypts it into your editor:

```bash
sops vars/docker_swarm.sops.yml
```

The decryption key never leaves my machine. SOPS usually pairs with [age](https://github.com/FiloSottile/age) for the actual encryption — think of SOPS as the workflow around encrypt and decrypt, and age as the thing doing the math. (SOPS also speaks PGP, AWS KMS, GCP KMS, and Azure Key Vault; age is just the common default.)

So can you keep `.env` files in your repo? Yes — as long as they're encrypted. The next question is always where the master key itself lives, and the honest answer is: wherever your threat model is comfortable with. I keep a copy in a private GitHub repo, because I trust GitHub that far. You could put it on a [YubiKey](https://www.yubico.com/) that only answers when it's physically plugged in, drop it in a password manager, or write it on a piece of paper in a drawer. Pick your level of paranoia.

Ansible hooks into all this through the [`community.sops`](https://github.com/ansible-collections/community.sops) plugin, set up in `ansible.cfg`:

```ini
[defaults]
inventory = ./inventory
host_key_checking = False
vars_plugins_enabled = host_group_vars, community.sops.sops

[inventory]
enabled_plugins = host_group_vars, community.sops.sops, yaml, ini
```

(`host_key_checking = False` skips the "trust this host? yes/no" SSH prompt — a small convenience for unattended runs.) Ansible decrypts SOPS on the fly, uses the values in memory, and never writes the plaintext back to disk.

---

## Deploying real workloads: Docker Swarm + Jinja2

Provisioning and base config done, you still have to actually run something. [Docker Compose](https://docs.docker.com/compose/) is already a declarative way to describe what runs on a single host, and [Docker Swarm](https://docs.docker.com/engine/swarm/) stretches that across multiple nodes. Ansible ties the two together.

My `deploy-docker-swarm` role does roughly this:

1. Initializes Swarm on the manager and joins the workers. (The first node to join becomes the manager/leader; later nodes join as workers and can be promoted or demoted afterward. A `when: inventory_hostname in groups['docker-swarm-managers']` check gates the init command.)
2. Loads the SOPS secrets into memory as variables with `set_fact`.
3. Creates the per-service directories on the remote, including `remote_root`, `remote_data`, and `remote_config`. This one bit me once: plain Docker will happily create a missing bind-mount path for you, but Swarm refuses and fails the deploy. So you make the directories yourself first.
4. Rsyncs the config templates up to the box.
5. Builds one big Compose file and deploys it.

### Why Jinja2 instead of plain Compose

Plain Compose with `.env` files is fine, honestly. But there are three things it can't do that I wanted:

1. Skip the `.env` shuffle altogether.
2. Drop secrets straight into the rendered Compose. (Once the file is on the server, having the value inline is no more exposed than keeping it in an `.env` next to it — same blast radius either way.)
3. Use real loops and conditionals — for example, a service that runs on three machines with small differences between them.

So every Compose fragment is a [Jinja2](https://jinja.palletsprojects.com/) template (`*.yml.j2`). It's still YAML; it just has variables that get filled in at render time:

```yaml
# services/ddns.yml.j2
  ddns:
    image: oznu/cloudflare-ddns
    environment:
      API_KEY: "{{ cloudflare_api_token }}"
      ZONE: "{{ cloudflare_managed_domains | split(',') | map('trim') | join(',') }}"
    volumes:
      - "{{ remote_config }}/ddns:/config"
```

A master template loops over the enabled services and stitches them into a single Compose file:

```jinja
networks:
  proxy:
    external: true

services:
{% for service in enabled_services %}
{% include "services/" + service + ".yml.j2" %}
{% endfor %}
```

The deploy tasks render and upload in one step — Ansible's built-in [`template`](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/template_module.html) module both builds the file and ships it — then deploy the stack:

```yaml
- name: Build and upload master compose file
  ansible.builtin.template:
    src: docker-compose.yml.j2
    dest: "{{ remote_root }}/docker-compose.yml"

- name: Deploy the stack
  community.docker.docker_stack:
    name: main
    compose:
      - "{{ remote_root }}/docker-compose.yml"
    prune: true
```

The net result: secrets stay encrypted in git, get injected only into the rendered file, and a single `docker_stack` call (with `prune: true` to clean up services you've removed) rolls the whole thing out.

---

## Two quality-of-life tools

### just — a command runner

[`just`](https://github.com/casey/just) is npm scripts for anything, basically. Rather than memorize a long command, you name it once in a `justfile`:

```make
run tags:
    ansible-playbook -i inventory main.yml --tags {{tags}} \
        && paplay /usr/share/sounds/freedesktop/stereo/complete.oga \
        && notify-send "Ansible finished"
```

Now `just run docker` runs the playbook scoped to the `docker` tags and, when it's done, plays a sound and fires a desktop notification — genuinely useful when a run takes a couple of minutes and you've wandered off.

You can also target hosts instead of tags:

```bash
# Whole group
ansible-playbook -i inventory --limit workstations main.yml
# A single machine
ansible-playbook -i inventory --limit matebook main.yml
```

### Dagger — decoupling CI from your CI provider

[Dagger](https://dagger.io/) is a swing at untangling your repo from one specific CI provider. If you've got 10,000 lines of GitHub Actions, you're effectively married to GitHub — moving to GitLab means rewriting all of it. Dagger turns the GitHub Actions workflow into a thin shell that just calls out to Dagger, and the real pipeline lives in code (Go, Python, or TypeScript) that runs the same everywhere.

The part I actually like is that it runs locally. Instead of the push-a-commit, stare-at-the-Actions-tab, push-again loop, you develop and test the pipeline on your laptop, because the whole thing runs in containers. If it passes locally, it almost certainly passes in CI.

My GitHub Actions file barely does anything — it just calls a Dagger function that runs [gitleaks](https://github.com/gitleaks/gitleaks) and [trufflehog](https://github.com/trufflesecurity/trufflehog) to scan for leaked secrets:

```yaml
name: Security Scan
on: [push]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dagger/dagger-for-github@v8.2.0
        with:
          verb: call
          args: scan --source=.
```

```python
# Dagger module (Python)
import dagger
from dagger import dag, function, object_type

@object_type
class Security:
    @function
    async def scan(self, source: dagger.Directory) -> str:
        # run gitleaks + trufflehog over the repo
        return await (
            dag.container()
            .from_("zricethezav/gitleaks:latest")
            .with_mounted_directory("/repo", source)
            .with_exec(["gitleaks", "detect", "--source", "/repo", "--no-git"])
            .stdout()
        )
```

Dagger still runs on GitHub's runners, so you don't have to manage your own machines — but the logic underneath is portable. (The older [`act`](https://github.com/nektos/act) project also runs Actions locally via Docker, though historically it was rough to work with; Dagger's container-native approach has been more reliable for me.) If you lean on GitHub-specific features like labels, PR metadata, or reviewers, you'll still want a thin slice of native Actions to feed that context into Dagger.

---

## Why bother: IaC as the single source of truth

Three payoffs make all of this worth the setup cost.

**Re-runs are free.** Because everything is declarative, running `pulumi up` or `ansible-playbook` again with an unchanged config does nothing — it checks that reality matches the description, reports all green, and stops. You can run it on every push to `main` if you want. Add a node to the file and it appears; delete it from the file and it's gone. The file is the truth.

**Everything becomes disposable.** Once your machines are code, losing hardware stops being scary. The only irreplaceable thing is the git repo. A server dies, you re-run the pipeline, it comes back.

**You get documentation for free.** When some careless engineer pokes around the cloud console and deletes a few instances by hand, is there a record anywhere of what was deployed? Normally, no. But if your IaC is the source of truth, then it *is* that record — re-run the apply and everything snaps back to its described state.

That last point has a string attached, though. It only holds if everyone is disciplined about it. The whole thing collapses the moment one person works through Ansible while another clicks around the Google console hand-creating VMs. You have to commit to it: the code is the source of truth, and it runs from CI/CD, not from whoever's laptop happened to be open that day.

### A great real-world use case: review apps

A pattern that exercises this whole stack nicely is **review apps**, sometimes called preview apps. You've got an open pull request and you want to run full end-to-end tests against it, or hand QA a working environment for some big unmerged feature. You can't use `dev` (shared) and you obviously can't use `prod`. So you spin up a complete, throwaway clone of your infrastructure — servers, load balancers, networks, frontend, backend, sometimes a database too. The whole thing is described in Terraform/Pulumi, created on demand, poked at via its own unique URL, and then destroyed so the meter stops. Five open PRs means five independent stacks, which is no big deal when the entire environment is just code.

### What about testing the infrastructure itself?

Honestly, testing IaC is awkward. A real "test" for Pulumi means spinning up a separate region, deploying everything there, pinging the servers a few times to check they answer, and tearing it all down. In practice most people just iterate on a `dev` stack until it looks right and then commit, letting prod apply the same change. In theory a declarative system that built once will build again — but it's imperative under the hood, so there's no guarantee. Big organizations write proper infra tests. For a personal setup, the effort rarely pays off.

### Who runs Pulumi, Ansible, or both?

If you want provisioning and config in one flow, either tool can drive the other — Pulumi has an Ansible plugin and Ansible has a Pulumi plugin. My preference is to make Ansible the top-level runner, since it's the older and more stable of the two, and have it call Pulumi. Or skip the coupling entirely and let CI run Pulumi first, then Ansible. All three are fine; pick whichever fits your head.

---


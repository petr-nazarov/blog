---
title: "Docker guides and best practices"
description: "A rant about Docker in practice: from builds to deployment"
date: 2026-03-09
tags: ["docker", "devops", "docker swarm", "kubernetes"]
---

# Docker in Practice: From Builds to Deployment

This is a summary of a lecture I gave on: A practical guide to Docker image optimization, multi-stage builds, Docker Compose, deployment strategies, and when (not) to use Kubernetes.

---



## 1. The Image Size Problem

Imagine you write a tiny Node.js server that weighs 500 KB. You put `FROM debian` in your Dockerfile. Debian, even without a graphical interface, is around **500 MB**. You now have a 500 MB image just to serve a 500 KB app. That's absurd.

```dockerfile
# Naive approach: ~500 MB image for a tiny app
FROM debian
RUN apt-get update && apt-get install -y nodejs npm
COPY . /app
WORKDIR /app
RUN npm install
RUN npm run build
CMD ["node", "dist/index.js"]
```

The solution? **Multi-stage builds.**

---

## 2. Multi-Stage Builds

The key insight: you don't have to build your app in the same image that runs it. You can use a heavy image for building (with compilers, build tools, etc.) and a tiny image for running.

```dockerfile
# Stage 1: Build (heavy, ~600 MB)
FROM debian AS builder
RUN apt-get update && apt-get install -y nodejs npm gcc g++
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

# Stage 2: Run (light, ~100 MB)
FROM node:alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

**What happens here:**

- The `builder` stage uses full Debian with all the tools you need: `gcc`, `g++`, `curl`, whatever your dependencies require (e.g., `bcrypt` needs a C++ compiler to build, but not to run).
- The final stage uses `node:alpine` -- Alpine Linux is a minimal distribution, typically **20-30 MB**. Add Node.js and you're at maybe **40-50 MB**.
- `COPY --from=builder` pulls only the built artifacts from the first stage.

**Result:** During the build process, the intermediate image is ~600 MB. But the final image that you actually ship and run is only ~100 MB. The builder stage is discarded.

---

## 3. Pre-Built Base Images

Even with caching, pulling cache in CI/CD pipelines takes time. If your builder stage installs the same system packages every time (Node.js, gcc, curl, etc.), you can extract that into a **pre-built base image**.

### The idea: three Dockerfiles

**`builder/Dockerfile`** -- things that rarely change:
```dockerfile
FROM debian
RUN apt-get update && apt-get install -y nodejs npm gcc g++ curl
```

**`runner/Dockerfile`** -- the runtime base:
```dockerfile
FROM node:alpine
RUN apk add --no-cache curl
# Example: install Doppler CLI for secret injection
RUN curl -Ls https://cli.doppler.com/install.sh | sh
```

**`myapp/Dockerfile`** -- the actual application:
```dockerfile
FROM my-registry/my-builder AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM my-registry/my-runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["doppler", "run", "--", "node", "dist/index.js"]
```

### Workflow

```bash
# One-time (or very rare): build and push base images
docker build -t my-registry/my-builder ./builder
docker push my-registry/my-builder

docker build -t my-registry/my-runner ./runner
docker push my-registry/my-runner

# Every deploy: only rebuild the app (fast!)
docker build -t my-registry/my-app ./myapp
docker push my-registry/my-app
```

**When to rebuild base images:**
- Bumping language version (e.g., Python 3.12 to 3.14, or Node 18 to 22)
- Critical security vulnerability in system packages (a 0-day in a Linux library)
- Adding a new system-level dependency

In practice, this might happen once every few months. Meanwhile, your app builds stay fast -- pulling a pre-built image is **10x faster** than re-running cached Dockerfile layers.

---

## 4. Docker Layers and Caching

Every instruction in a Dockerfile creates a **layer**. An image is essentially a stack of these layers.

```dockerfile
FROM node:alpine          # Layer 1 (base)
WORKDIR /app              # Layer 2
COPY package*.json ./     # Layer 3
RUN npm install           # Layer 4
COPY . .                  # Layer 5
RUN npm run build         # Layer 6
CMD ["node", "dist/index.js"]
```

**Caching rules:**
- Docker caches each layer.
- If a layer hasn't changed since the last build, Docker reuses the cached version.
- **Critical rule:** once a layer is invalidated, **all subsequent layers are also invalidated.** There's no skipping ahead.
- For `COPY` instructions, Docker checks the hash of the files being copied. If you copy the same content, the cache holds.

Two images based on the same `FROM` share those base layers on disk. Docker doesn't store duplicate layers.

---

## 5. Optimizing Cache with Layer Ordering

Since cache invalidation cascades downward, the order of your Dockerfile instructions matters a lot.

### Bad: copy everything, then install

```dockerfile
FROM node:alpine
WORKDIR /app
COPY . .                  # Source code changes often -> invalidates next layer
RUN npm install           # Re-runs every time code changes!
RUN npm run build
```

### Good: copy dependency files first, then source code

```dockerfile
FROM node:alpine
WORKDIR /app
COPY package.json package-lock.json ./   # Changes rarely (maybe weekly)
RUN npm install                          # Cached for a whole week!
COPY . .                                 # Changes daily, but npm install is cached
RUN npm run build
```

**Why this matters beyond speed:**
- When you push to a registry, it also works at the layer level.
- Smaller changed layers = less data pushed = **lower storage and transfer costs** on your registry.
- If the old approach changes 100 MB per push but the optimized one changes only 20 MB, you've just cut your registry costs 5x over a year.

---

## 6. Docker Registries

A Docker registry is an authenticated storage for Docker images. When you write `FROM debian`, you're pulling from Docker Hub -- the default public registry.

**Common registries:**
- **Docker Hub** -- the default, public registry
- **GitHub Container Registry** (ghcr.io) -- integrated with GitHub
- **AWS ECR** -- Amazon's registry
- **Google Artifact Registry** -- Google Cloud's registry
- **Self-hosted** -- you can run your own (e.g., Harbor)

```bash
# Tag and push to a registry
docker build -t ghcr.io/myorg/myapp:latest .
docker push ghcr.io/myorg/myapp:latest

# Pull from a registry
docker pull ghcr.io/myorg/myapp:latest
```

---

## 7. CI/CD Pipelines

In a real project, you don't build Docker images by hand. You set up a CI/CD pipeline. Here's a simplified GitHub Actions example:

```yaml
# .github/workflows/ci.yaml
name: Build and Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t my-registry/myapp:latest ./myapp

      - name: Push to registry
        run: docker push my-registry/myapp:latest

      - name: Deploy
        run: |
          ssh my-server "docker pull my-registry/myapp:latest && docker compose up -d"
```

The pipeline triggers on every push to main: checkout the repo, build the image, push it to the registry, then deploy.

---

## 8. How Docker Actually Works

Docker is **not** a virtual machine. The key difference:

| | Virtual Machine | Docker Container |
|---|---|---|
| **Kernel** | Has its own kernel | Shares the host kernel |
| **Overhead** | Heavy (full OS) | Lightweight (process isolation) |
| **Startup** | Minutes | Seconds |

Docker uses Linux kernel features (namespaces, cgroups) to isolate processes. Each container is essentially an isolated process with its own filesystem, network, and process tree -- but it shares the host's kernel.

Under `/proc` on the host, Docker isolates process trees so containers can't see each other.

### Docker on macOS

Since Docker needs a Linux kernel and macOS doesn't have one, Docker Desktop runs a lightweight Linux VM under the hood. This adds a layer of virtualization that doesn't exist on a native Linux host. The "layers of nesting" on a Mac look like:

```
Mac hardware -> macOS kernel -> lightweight Linux VM -> Docker -> your container
```

On a native Linux server, it's simpler:

```
Linux hardware -> Linux kernel -> Docker -> your container
```

---

## 9. Cross-Platform Builds

If you build an image on an Apple Silicon Mac (ARM architecture) and try to run it on an AMD64 Linux server, it won't work by default. You need to specify the target architecture:

```bash
docker build --platform linux/amd64 -t myapp:latest .
```

This tells Docker to build for AMD64 regardless of the host architecture. The resulting image will run natively on AMD64 servers but will be emulated (slower) if you run it locally on an ARM Mac.

---

## 10. Docker Compose

While a `Dockerfile` describes a single image, **Docker Compose** describes how multiple containers work together. It's your first level of orchestration.

A typical small production stack:

```yaml
# docker-compose.yml
services:
  api:
    image: my-registry/myapi:latest
    ports:
      - "9090:80"
    networks:
      - mynet
    environment:
      - DOPPLER_TOKEN=xxx
      - MONGO_URI=mongodb://mongo:27017/mydb

  client:
    image: my-registry/myclient:latest
    ports:
      - "3000:80"
    networks:
      - mynet
    environment:
      - API_URL=http://api:80

  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    networks:
      - mynet

  redis:
    image: redis:alpine
    networks:
      - mynet

networks:
  mynet:

volumes:
  mongo-data:
```

### Internal networking

When you run `docker compose up`, all services join a virtual network. They can reach each other **by service name**. That's why the client's `API_URL` is `http://api:80` -- not `http://localhost:9090`. The service name `api` resolves to the correct container IP within the Docker network.

Two backend services can communicate this way without ever exposing ports to the host.

---

## 11. Deploying with Docker

### The simple approach (90% of small companies)

```bash
# Copy compose file to the server
scp docker-compose.yml my-server:~/

# SSH in and start everything
ssh my-server "docker compose up -d"
```

The `-d` flag runs containers in detached mode (background). This is straightforward and works well for simple setups. Honestly, this is how most small companies run Docker in production.

---

## 12. Docker Context

Instead of SSHing into your server manually, you can configure a **Docker context** so that your local Docker CLI talks directly to a remote Docker daemon.

```bash
# Create a context pointing to your server
docker context create my-server --docker "host=ssh://user@my-server"

# List available contexts
docker context ls

# Switch to the remote context
docker context use my-server

# Now all docker commands run on the remote server!
docker compose up -d    # This runs on my-server, not locally
```

Docker context works over SSH, so if your SSH config already knows how to reach `my-server`, Docker context picks that up automatically. No need to SCP files or SSH in manually.

---

## 13. Volumes and Data Persistence

Docker containers are **ephemeral** -- when a container dies, its filesystem dies with it. To persist data (databases, uploads, configs), you use **volumes**.

```yaml
services:
  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db    # Named volume

volumes:
  mongo-data:                   # Persists across container restarts
```

### Backing up volumes

You can run a dedicated container just for backups. For example, [Restic](https://restic.net/) can snapshot your volume directories and push them to S3-compatible storage:

```yaml
services:
  backup:
    image: restic/restic
    volumes:
      - mongo-data:/data/mongo:ro
    environment:
      - RESTIC_REPOSITORY=s3:s3.amazonaws.com/my-backups
      - AWS_ACCESS_KEY_ID=xxx
      - AWS_SECRET_ACCESS_KEY=xxx
```

Restic works incrementally -- it only uploads the differences each day, saving storage costs.

### Multi-node volume problem

If you're running multiple nodes (Docker Swarm or Kubernetes), volumes are local to a machine. If a container with a mounted volume moves to another node, **the data doesn't follow it**. Solutions:
- **Pin the container** to a specific node (via deployment constraints like `hostname`)
- Use **network-attached storage** (NAS) that all nodes can access
- Use a managed database service instead of self-hosting

---

## 14. Health Checks

Sometimes a process is alive but not actually working (the server crashed internally but the process didn't exit). Health checks solve this.

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost/health || exit 1
```

**How it works:**
- Every 30 seconds, Docker runs `curl` against the `/health` endpoint.
- If it gets a 200 response, the container is **healthy**.
- If it fails 3 times in a row, the container is marked **unhealthy** and gets restarted (when combined with a restart policy).

### Implementing the health endpoint

In an ideal world, your `/health` endpoint checks all dependencies:

```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "version": "1.2.3"
}
```

In practice, most people just return the app version. If the server responds at all, it's healthy. If it doesn't, it's dead.

The health check command can be any shell command that exits with code 0 (healthy) or non-zero (unhealthy). It doesn't have to be `curl` -- you could check if a file was modified recently, or if a TCP port is open.

---

## 15. One Process Per Container

Docker ties the **container lifecycle** to the lifecycle of its main process (PID 1). If that process dies, the container dies. This is a Docker superpower.

```dockerfile
# This process IS the container
CMD ["node", "server.js"]
```

**Can you run two processes in one container?** Technically yes:

```dockerfile
CMD ["sh", "-c", "node worker.js & node server.js"]
```

But `sh` becomes PID 1 (the main process), with both Node processes as its children. If `worker.js` crashes, the container has no idea -- it only watches PID 1. This is an **anti-pattern**.

**The right approach:** one process, one container. Need a worker and a server? Make two containers.

```yaml
services:
  api:
    image: myapp
    command: ["node", "server.js"]
  worker:
    image: myapp
    command: ["node", "worker.js"]
```

---

## 16. Restart Policies

Control what happens when a container stops:

```yaml
services:
  api:
    image: myapp
    restart: always          # Always restart, even after reboot

  worker:
    image: myapp
    restart: unless-stopped  # Restart unless explicitly stopped
```

| Policy | Behavior |
|---|---|
| `no` | Never restart (default) |
| `always` | Always restart, including after host reboot |
| `unless-stopped` | Like `always`, but stays stopped if you explicitly ran `docker stop` |
| `on-failure` | Only restart if the process exited with non-zero code |

**Important distinction:**
- `docker stop` stops a container.
- `docker compose down` tears down the entire composition -- even `restart: always` won't bring it back.

Docker itself runs as a system service (typically via systemd). If the host reboots and Docker starts, containers with `restart: always` come back automatically.

---

## 17. Docker Swarm vs Kubernetes

### What Kubernetes offers

Kubernetes can auto-scale based on metrics:
- If CPU utilization > 80%, spin up a new container
- If requests per minute > 1000, add more replicas
- If traffic drops, scale down
- Schedule containers across geographic regions

### The cost reality

**Managed Kubernetes** (GKE, EKS, AKS):
- A VM that costs $100/month as a plain VM might cost **$300/month** as a Kubernetes node.
- You're paying for the managed service, security compliance, and auto-scaling features.
- "Auto-scaling" on managed services like GKE Autopilot sounds magical, but spinning up new nodes can take **several minutes** -- not great for sudden traffic spikes unless you plan around schedules.

**Self-hosted Kubernetes:**
- Same VMs at the regular price ($100/month each).
- But now you need to install, configure, secure, and maintain Kubernetes yourself.
- Getting Kubernetes to meet security compliance standards is easily **two weeks of work**.

**Docker Swarm:**
- Works with Docker Compose syntax (with minor additions).
- Much simpler to set up and manage.
- Handles multiple nodes, rolling deployments, service discovery.
- Perfect for 2-10 nodes.

### When to use what

| Scale | Recommendation |
|---|---|
| 1 server | Docker Compose |
| 2-10 servers | Docker Swarm |
| 50+ servers, global traffic | Kubernetes |
| Don't want to think about it | PaaS (Vercel, Railway, etc.) |

For most startups and small companies, **Docker Swarm is more than enough**. The money you save by not using managed Kubernetes (and the engineering time you save by not managing it yourself) is significant. You're paying a developer $6K/month, but obsessing over saving $1K on infrastructure while that developer spends days debugging Kubernetes labels specific to your cloud provider's implementation.

> "If someone asks you in an interview how you'd set up Kubernetes, the best answer starts with: let me explain why you probably don't need Kubernetes." -- and then you explain the costs, the complexity, and how Docker Swarm covers 95% of use cases.

---

## 18. Platform-as-a-Service Alternatives

If you don't want to manage deployment at all:

### Hosted PaaS
- **Vercel** -- connect your repo, describe your start command, done. Perfect for side projects and low-traffic apps. Gets expensive fast at scale.
- **Railway**, **Render**, **Fly.io** -- similar concept, various pricing models.

### Self-Hosted PaaS
- **Coolify** -- open-source, self-hosted alternative to Vercel/Netlify.
- **Dokploy** -- similar concept, connects to your GitHub, builds and deploys automatically.

These provide:
- Connect GitHub repo
- Automatic builds on push to main
- Pre-built templates for databases (MongoDB, PostgreSQL, Redis, etc.)
- SSL certificates, domain management

Great for projects where you don't want to manage infrastructure. Not ideal when you need fine-grained control over every configuration detail.

---

## 19. Security and Compliance

Everything discussed so far is "make it work." Making it **production-ready and secure** is a whole separate effort that applies regardless of whether you use Docker Compose, Swarm, or Kubernetes:

- **Reverse proxy** with proper headers (CORS, CSP, HSTS, etc.) -- tools like Traefik, Nginx, Caddy
- **IP hiding** behind Cloudflare proxy
- **VPN access** (e.g., WireGuard container) so SSH and admin panels aren't publicly exposed
- **Log collection** with write-once storage (WORM) so logs can't be tampered with
- **Monitoring** with Grafana, Prometheus, Loki
- **HTTPS everywhere** with proper certificate management
- **Access logs** for compliance auditing

The only way to avoid all of this yourself is to use a managed PaaS (Vercel, etc.) where it's handled for you. That's their business model.

---

## 20. Docker Alternatives

- **Podman** -- open-source, drop-in Docker replacement. Lighter resource usage (~50 MB RAM vs Docker Desktop's multi-GB appetite). No daemon required. Most Compose files work without changes, but some niche projects don't support it.
- **Apple Containers** -- native container runtime for macOS written in Swift. Very new (2025), very fast. Worth watching but too early for production reliance.
- **Docker CLI without Docker Desktop** -- you can run the Docker engine without the Desktop GUI, saving significant resources on Mac/Windows.

---

## Key Takeaways

1. **Always use multi-stage builds.** Separate build-time dependencies from runtime.
2. **Order Dockerfile instructions by change frequency.** Things that change rarely go first (base image, dependencies), things that change often go last (source code).
3. **Pre-build base images** for builder and runner stages when your CI/CD pipeline is slow.
4. **Use Alpine-based images** for production to minimize image size.
5. **One process per container.** Period.
6. **Docker Compose is your friend** for local development and small deployments.
7. **Docker Context** lets you manage remote Docker hosts without SSH gymnastics.
8. **Health checks** catch silent failures that wouldn't kill the process.
9. **Volumes** are the answer for persistent data in ephemeral containers.
10. **You probably don't need Kubernetes.** Docker Swarm handles most real-world scenarios at a fraction of the cost and complexity.

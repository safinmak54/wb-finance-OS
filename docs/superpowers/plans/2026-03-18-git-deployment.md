# Git Deployment Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the local WB Finance OS repo to GitHub and establish a two-environment Vercel deployment pipeline with `qa` and `main` branches.

**Architecture:** Add the existing private GitHub repo as the `origin` remote, push the local `main` branch to trigger a Vercel Production deploy, then create and push a `qa` branch to establish a stable Vercel QA preview URL. No code changes are required — this is purely git and repository configuration.

**Tech Stack:** Git, GitHub CLI (`gh`), Vercel (dashboard only, no CLI needed)

---

### Task 1: Resolve Untracked Files

**Files:**
- Commit: `CLAUDE.md`
- Commit: `seed.sql`

- [ ] **Step 1: Stage both untracked files**

```bash
cd "/Users/safinmaknojia/Documents/Claude Projects/WB Financial dashboard"
git add CLAUDE.md seed.sql
```

- [ ] **Step 2: Verify staged files**

```bash
git status
```

Expected output includes:
```
Changes to be committed:
  new file:   CLAUDE.md
  new file:   seed.sql
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: add CLAUDE.md project instructions and seed.sql"
```

Expected: `[main <hash>] chore: add CLAUDE.md project instructions and seed.sql`

---

### Task 2: Add GitHub Remote

**Files:** No file changes — git config only.

- [ ] **Step 1: Verify no remote is currently set**

```bash
git remote -v
```

Expected: no output (empty)

- [ ] **Step 2: Add the remote**

```bash
git remote add origin https://github.com/safinmak54/wb-finance-OS.git
```

- [ ] **Step 3: Verify remote was added**

```bash
git remote -v
```

Expected:
```
origin  https://github.com/safinmak54/wb-finance-OS.git (fetch)
origin  https://github.com/safinmak54/wb-finance-OS.git (push)
```

---

### Task 3: Check Remote Repo State and Push `main`

- [ ] **Step 1: Verify GitHub authentication**

```bash
gh auth status
```

Expected: shows logged-in user and active token. If not authenticated, run `gh auth login` and follow the prompts before continuing.

- [ ] **Step 2: Check if the remote has any commits**

```bash
git ls-remote origin
```

- If output is **empty** → remote is empty, proceed to Step 2.
- If output has commits (e.g., a README) → run `git pull --rebase origin main` before pushing to reconcile histories.

- [ ] **Step 3: Push `main` to GitHub**

```bash
git push -u origin main
```

Expected: branch pushes successfully and tracking is set:
```
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

Vercel will automatically trigger a Production deployment upon receiving this push.

- [ ] **Step 4: Verify push on GitHub**

Open `https://github.com/safinmak54/wb-finance-OS` in a browser and confirm all 4 commits are visible (3 original + the CLAUDE.md/seed.sql commit).

---

### Task 4: Create and Push `qa` Branch

- [ ] **Step 1: Create `qa` branch off current `main`**

```bash
git checkout -b qa
```

Expected: `Switched to a new branch 'qa'`

- [ ] **Step 2: Push `qa` branch to GitHub**

```bash
git push -u origin qa
```

Expected:
```
Branch 'qa' set up to track remote branch 'qa' from 'origin'.
```

Vercel will automatically trigger a QA Preview deployment for the `qa` branch.

- [ ] **Step 3: Verify QA deployment URL**

Open the Vercel dashboard → project → Deployments tab. Confirm a new deployment for the `qa` branch appears. Note the stable branch alias URL (format: `wb-finance-os-git-qa-safinmak54.vercel.app`) — this is the URL to share with reviewers.

- [ ] **Step 4: Switch back to `main` for ongoing work**

```bash
git checkout main
```

---

### Task 5: Commit the Spec and Plan Docs

- [ ] **Step 1: Ensure you are on `main`**

```bash
git checkout main
```

- [ ] **Step 2: Stage the docs directory**

```bash
git add docs/
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add git deployment spec and implementation plan"
```

- [ ] **Step 4: Push `main`**

```bash
git push origin main
```

- [ ] **Step 5: Merge `main` into `qa` so both branches are in sync, then push**

```bash
git checkout qa
git merge main
git push origin qa
git checkout main
```

---

## Post-Setup Workflow Reference

```
# Working on a change:
git checkout qa
# make changes
git add <files>
git commit -m "feat: ..."
git push origin qa       # → Vercel deploys to QA URL automatically

# Promoting to production:
# Open GitHub PR: qa → main, review, merge
# OR:
git checkout main
git merge qa
git push origin main     # → Vercel deploys to Production automatically
```

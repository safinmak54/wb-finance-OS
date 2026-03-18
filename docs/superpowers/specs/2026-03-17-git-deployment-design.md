# Git Deployment Setup — WB Finance OS

**Date:** 2026-03-17
**Status:** Draft

## Overview

Connect the local git repository to the existing GitHub repo and Vercel project, establishing a two-environment deployment pipeline with a `qa` branch for review and `main` for production.

## Repository

- **GitHub:** `https://github.com/safinmak54/wb-finance-OS` (private, already exists and connected to Vercel)
- **Local:** `/Users/safinmaknojia/Documents/Claude Projects/WB Financial dashboard`

## Branch Strategy

| Branch | Environment | Purpose |
|--------|-------------|---------|
| `main` | Production | Live, stable version — auto-deploys to prod on push |
| `qa` | QA Preview | Testing and feedback before promotion to prod |

## QA Preview URL

Vercel automatically creates a **stable, persistent preview URL per branch**. The `qa` branch will be accessible at a consistent URL following Vercel's branch alias convention (e.g., `wb-finance-os-git-qa-safinmak54.vercel.app`). The exact URL is shown in the Vercel dashboard after the first push. This URL remains stable across pushes — always reflecting the latest `qa` deployment.

## Deployment Flow

```
local changes
    → push to qa branch
        → Vercel deploys to stable QA URL (auto)
            → review and approve
                → merge qa → main via GitHub PR
                    → Vercel deploys to Production (auto)
```

**Merge strategy:** GitHub PR from `qa` → `main` (standard workflow). Direct local merge is acceptable for urgent hotfixes only.

## Pre-Push Checklist

Before pushing, the following must be resolved:

1. **Authentication:** Ensure GitHub access is configured (GitHub CLI `gh auth login`, SSH key, or HTTPS personal access token). The push will fail without this.

2. **Untracked files:** The repo currently has two untracked files:
   - `CLAUDE.md` — project instructions for Claude Code; commit this to the repo
   - `seed.sql` — review before committing; if it contains sensitive data, add to `.gitignore`

3. **Remote repo state:** If the GitHub repo has existing commits (e.g., an auto-generated README), a plain push will be rejected. Resolution: `git pull --rebase origin main` to reconcile histories. If the remote is empty, push proceeds normally.

## Implementation Steps

1. Resolve untracked files: commit `CLAUDE.md`, decide on `seed.sql` (commit or `.gitignore`)
2. Verify GitHub authentication
3. Check remote repo state: `git ls-remote origin` — if empty, proceed; if not, rebase first
4. Add GitHub remote: `git remote add origin https://github.com/safinmak54/wb-finance-OS`
5. Push `main` to GitHub (triggers Vercel Production deploy)
6. Create `qa` branch off `main` and push (triggers Vercel QA preview deploy)

## Rollback

**Production (`main`):** Vercel supports instant rollback via the dashboard (Deployments tab → select a prior deployment → Promote to Production). Alternatively, revert the merge commit on `main` and push.

**QA (`qa`):** Push a revert commit to `qa` — Vercel will redeploy the reverted state automatically.

## Out of Scope

- Vercel dashboard configuration (already connected; branch preview URLs are automatic)
- Environment variables or secrets management
- Branch protection rules (can be added later)
- CI/CD checks or test runners (no test suite exists)

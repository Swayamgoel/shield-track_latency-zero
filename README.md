# ShieldTrack Monorepo

![42%](https://progress-bar.xyz/35/?title=Project%20completed)

## Prerequisites

- Node.js 20+
- pnpm 9+

## Setup

1. Copy the environment template to your local machine:

   ```sh
   cp .env.example .env
   ```

2. Open `.env` and fill in your Supabase credentials (this single root `.env` file powers the mobile app, admin portal, API, and Python ML Backend).
3. Install the workspace dependencies:

   ```sh
   pnpm setup
   ```

## Run apps

```sh
pnpm dev:admin
pnpm dev:mobile
pnpm dev:api
```

## Build

```sh
pnpm build
```

## Troubleshooting

- Make sure you are running commands from the repo root.
- If dependencies seem stale, run `pnpm install` again.

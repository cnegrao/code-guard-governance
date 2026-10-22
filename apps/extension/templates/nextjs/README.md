# CodeGuard Next.js Integration Template

This template demonstrates how to integrate CodeGuard AI compliance scanning into a Next.js application using API Routes.

## Setup

1. Install the SDK:
   ```bash
   npm install @codeguard/sdk
   ```

2. Add your API Key to `.env.local`:
   ```bash
   CODEGUARD_API_KEY=your_key_here
   ```

3. Copy `pages/api/scan.ts` to your project's `pages/api` directory (or `app/api/scan/route.ts` if using App Router).

## Usage

Send a POST request to `/api/scan`:

```json
{
  "code": "const password = '123';",
  "region": "BR"
}
```

## Security Note

Always run the scan serverside (API Route) to keep your `CODEGUARD_API_KEY` secret. Never expose it in client-side code unless using a proxy.

Technical results include a closed `analysis_boundary`, per-reference `analysis_state`, separate `completeness`, and source/acquisition limitations. `NO_FINDINGS_DETECTED` requires all declared-input batches to complete and does not establish framework satisfaction or legal compliance. HTTP `success` means execution only; inspect `UNKNOWN` and incomplete reviews. Engineering fixes establish no compliance conclusion. `/api/v1/scan` is a LEGACY_TRANSPORT_IDENTIFIER.

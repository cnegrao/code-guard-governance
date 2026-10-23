# CodeGuard Lovable (Supabase Edge) Template

This template is optimized for Lovable projects that use Supabase Edge Functions. It allows you to run non-authoritative technical framework reviews without spinning up a dedicated Node.js server.

## Setup

1. Initialize Supabase in your project if needed:
   ```bash
   supabase init
   ```

2. Create the function:
   ```bash
   supabase functions new codeguard-scan
   ```

3. Copy the content of `index.ts` to `supabase/functions/codeguard-scan/index.ts`.

4. Set your Environment Secret:
   ```bash
   supabase secrets set CODEGUARD_API_KEY=your_key_here
   ```

5. Deploy:
   ```bash
   supabase functions deploy codeguard-scan
   ```

## Usage from Lovable Frontend

```javascript
/* Inside your Lovable React Component */
const { data, error } = await supabase.functions.invoke('codeguard-scan', {
  body: {
    code: 'const user = { pass: "123" }',
    region: 'EU'
  }
})

if (data.result.total_findings > 0) {
  console.log("Potential technical findings returned; review completeness and limitations.");
}
```

Technical results include a closed `analysis_boundary`, per-reference `analysis_state`, separate `completeness`, and source/acquisition limitations. `NO_FINDINGS_DETECTED` requires all declared-input batches to complete and does not establish framework satisfaction or legal compliance. HTTP `success` means execution only; inspect `UNKNOWN` and incomplete reviews. Engineering fixes establish no compliance conclusion. `/api/v1/scan` is a LEGACY_TRANSPORT_IDENTIFIER.

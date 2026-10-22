# @codeguard/sdk

Universal SDK for CodeGuard AI Technical Framework Review API.

## Installation

```bash
npm install @codeguard/sdk
# or
yarn add @codeguard/sdk
# or
pnpm add @codeguard/sdk
```

## Quick Start

```typescript
import { createClient } from '@codeguard/sdk';

const client = createClient({
    apiKey: 'your-api-key',
    email: 'your@email.com'
});

// Scan code
const result = await client.scan({
    code: 'const password = "abc123";',
    region: 'EU'
});

console.log(result.result?.results.flatMap(review => review.findings));

// Generate fix
const patch = await client.patch({
    filePath: 'auth.ts',
    line: 5,
    violation: 'Hardcoded credential detected',
    code: 'const password = "abc123";'
});

console.log(patch.patch?.fixedCode);
```

## Usage with Frameworks

### React

```tsx
import { createClient } from '@codeguard/sdk';

const client = createClient({ apiKey: process.env.CODEGUARD_KEY });

function CodeChecker() {
    const [issues, setIssues] = useState([]);
    
    const scan = async (code: string) => {
        const result = await client.scan({ code, region: 'BR' });
        setIssues(result.result?.results.flatMap(review => review.findings) || []);
    };
    
    return <button onClick={() => scan(code)}>Scan</button>;
}
```

### Next.js API Route

```typescript
// pages/api/scan.ts
import { createClient } from '@codeguard/sdk';

const client = createClient({ apiKey: process.env.CODEGUARD_KEY });

export default async function handler(req, res) {
    const result = await client.scan(req.body);
    res.json(result);
}
```

## API Reference

### `createClient(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | string | `https://api.codeguard.ai` | API base URL |
| `apiKey` | string | - | API key for authentication |
| `email` | string | - | User email for credits |
| `timeout` | number | `30000` | Request timeout in ms |

### `client.scan(request)`

Review supplied source for potential technical findings.

### `client.patch(request)`

Generate an auto-fix for a specific violation.

### `client.getCredits()`

Get current credit balance.

### `client.health()`

Check API health status.

## License

MIT

Technical results include a closed `analysis_boundary`, per-reference `analysis_state`, separate `completeness`, and source/acquisition limitations. `NO_FINDINGS_DETECTED` requires all declared-input batches to complete and does not establish framework satisfaction or legal compliance. HTTP `success` means execution only; inspect `UNKNOWN` and incomplete reviews. Engineering fixes establish no compliance conclusion. `/api/v1/scan` is a LEGACY_TRANSPORT_IDENTIFIER.

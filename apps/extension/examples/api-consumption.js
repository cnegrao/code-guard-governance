/**
 * CodeGuard AI - Production API Examples
 *
 * Official Base URL: https://code-guard.eu
 */

const BASE_URL = 'https://code-guard.eu';
const API_KEY = 'your-production-api-key';

// ===========================================
// 1. JAVASCRIPT/TYPESCRIPT - Fetch API
// ===========================================

async function scanWithFetch() {
    try {
        const response = await fetch(`${BASE_URL}/api/scan`, {
            method: 'POST',
            headers: {
                'x-api-key': API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                region: 'BR',
                frameworks: ['LGPD', 'ISO27001']
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`API Error: ${error.message}`);
        }

        const result = await response.json();
        console.log('Scan Result:', result);
        return result;
    } catch (error) {
        console.error('Error:', error);
    }
}

// ===========================================
// 2. JAVASCRIPT/TYPESCRIPT - Axios
// ===========================================

// npm install axios
import axios from 'axios';

async function scanWithAxios() {
    try {
        const response = await axios.post(`${BASE_URL}/api/scan`, {
            region: 'BR',
            frameworks: ['LGPD', 'ISO27001']
        }, {
            headers: {
                'x-api-key': API_KEY
            }
        });

        console.log('Scan Result:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

// ===========================================
// 3. PYTHON - Requests
// ===========================================

// pip install requests
import requests

def scan_with_requests():
    try:
        response = requests.post(f"{BASE_URL}/api/scan", json={
            "region": "BR",
            "frameworks": ["LGPD", "ISO27001"]
        }, headers={
            "x-api-key": API_KEY,
            "Content-Type": "application/json"
        })

        response.raise_for_status()  # Raise exception for bad status codes
        result = response.json()
        print("Scan Result:", result)
        return result
    except requests.exceptions.RequestException as e:
        print(f"Error: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response: {e.response.text}")

// ===========================================
// 4. PYTHON - httpx (async)
// ===========================================

// pip install httpx
import httpx
import asyncio

async def scan_with_httpx():
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(f"{BASE_URL}/api/scan", json={
                "region": "BR",
                "frameworks": ["LGPD", "ISO27001"]
            }, headers={
                "x-api-key": API_KEY
            })

            response.raise_for_status()
            result = response.json()
            print("Scan Result:", result)
            return result
        except httpx.HTTPError as e:
            print(f"Error: {e}")
            if hasattr(e, 'response') and e.response:
                print(f"Response: {e.response.text}")

// ===========================================
// 5. CURL - Terminal
// ===========================================

# Scan
curl -X POST https://your-app.vercel.app/api/scan \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"region": "BR", "frameworks": ["LGPD", "ISO27001"]}'

# Graph
curl -X POST https://your-app.vercel.app/api/graph \
  -H "x-api-key: your-api-key"

# Shadow APIs
curl -X POST https://your-app.vercel.app/api/shadow-apis \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"content": "app.get(\"/api/users\", (req, res) => { res.json(users); });"}'

# OpenAPI Spec
curl https://your-app.vercel.app/api/openapi

// ===========================================
// 6. NODE.JS - SDK Usage
// ===========================================

// npm install codeguard-sdk
import CodeGuardClient from 'codeguard-sdk';

async function useSDK() {
    const client = new CodeGuardClient({
        apiKey: API_KEY,
        baseUrl: BASE_URL
    });

    try {
        // Scan
        const scanResult = await client.scan({
            region: 'BR',
            frameworks: ['LGPD', 'ISO27001']
        });
        console.log('Scan:', scanResult);

        // Graph
        const graphResult = await client.generateGraph();
        console.log('Graph:', graphResult);

        // Shadow APIs
        const shadowResult = await client.detectShadowAPIs({
            content: 'app.get("/api/users", (req, res) => { res.json(users); });'
        });
        console.log('Shadow APIs:', shadowResult);

    } catch (error) {
        console.error('SDK Error:', error);
    }
}

// ===========================================
// 7. REACT/FRONTEND - useEffect + Fetch
// ===========================================

import { useState, useEffect } from 'react';

function TechnicalFrameworkScanner() {
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const scanCode = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`${BASE_URL}/api/scan`, {
                method: 'POST',
                headers: {
                    'x-api-key': API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    region: 'BR',
                    frameworks: ['LGPD', 'ISO27001']
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            setResult(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <button onClick={scanCode} disabled={loading}>
                {loading ? 'Scanning...' : 'Scan Code'}
            </button>

            {error && <div style={{color: 'red'}}>Error: {error}</div>}

            {result && (
                <pre>{JSON.stringify(result, null, 2)}</pre>
            )}
        </div>
    );
}

// ===========================================
// 8. GITHUB ACTIONS - CI/CD Integration
// ===========================================

# .github/workflows/technical-review.yml
name: Technical Framework Review

on: [push, pull_request]

jobs:
  technical-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run technical framework review
        run: |
          curl -X POST https://your-app.vercel.app/api/scan \
            -H "x-api-key: ${{ secrets.CODEGUARD_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "region": "BR",
              "frameworks": ["LGPD", "ISO27001"]
            }' > technical-review-result.json

      - name: Inspect technical result
        run: |
          jq '{analysis_boundary, total_findings, frameworks_unknown, results: [.results[] | {framework, analysis_state, completeness}]}' technical-review-result.json
          echo "Review source scope, completeness and potential findings. No framework attainment is determined."

// ===========================================
// 9. ERROR HANDLING & RETRY LOGIC
// ===========================================

async function scanWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(`${BASE_URL}/api/scan`, {
                method: 'POST',
                headers: {
                    'x-api-key': API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    region: 'BR',
                    frameworks: ['LGPD', 'ISO27001']
                })
            });

            if (response.status === 429) {
                // Rate limited - wait and retry
                const resetTime = response.headers.get('X-RateLimit-Reset');
                const waitTime = resetTime ? (new Date(resetTime * 1000) - Date.now()) : 60000;
                console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`API Error: ${error.message}`);
            }

            return await response.json();

        } catch (error) {
            console.error(`Attempt ${attempt} failed:`, error.message);

            if (attempt === maxRetries) {
                throw error;
            }

            // Exponential backoff
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// ===========================================
// 10. BATCH PROCESSING
// ===========================================

async function batchScan(files) {
    const results = [];

    for (const file of files) {
        try {
            console.log(`Scanning ${file.path}...`);

            const result = await fetch(`${BASE_URL}/api/shadow-apis`, {
                method: 'POST',
                headers: {
                    'x-api-key': API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: file.content
                })
            });

            if (result.ok) {
                const data = await result.json();
                results.push({
                    file: file.path,
                    result: data,
                    status: 'success'
                });
            } else {
                results.push({
                    file: file.path,
                    error: result.statusText,
                    status: 'error'
                });
            }

            // Rate limiting - wait between requests
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            results.push({
                file: file.path,
                error: error.message,
                status: 'error'
            });
        }
    }

    return results;
}

// Usage
const files = [
    { path: 'api.js', content: 'app.get("/users", ...)' },
    { path: 'auth.js', content: 'router.post("/login", ...)' }
];

batchScan(files).then(results => {
    console.log('Batch results:', results);
});
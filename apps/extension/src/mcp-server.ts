#!/usr/bin/env node

/**
 * CodeGuard AI - Universal MCP Server (Enterprise Edition)
 * Powered by Antigravity Core Dispatcher.
 * 
 * This server follows the official Model Context Protocol (MCP) spec:
 * - Robust error handling
 * - Secure path sandboxing
 * - Unified authentication
 * - Support for Stdio (Local) and SSE (Cloud/Remote)
 */

import 'dotenv/config';
import express from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { AuditDispatcher } from './core/dispatcher';
import { UnifiedAuthenticator } from './core/auth';
import { SecurityGuard } from './core/security';

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const TRANSPORT_MODE = process.env.TRANSPORT_MODE || 'stdio';

// --- CORE DISPATCHER ---
const dispatcher = new AuditDispatcher();

/**
 * Creates and configures the CodeGuard MCP Server
 */
function createMcpServer() {
    const server = new McpServer({
        name: "codeguard-ai",
        version: "1.2.1"
    }, {
        capabilities: {
            tools: {},
            resources: {},
            prompts: {}
        }
    });

    // 1. LEGACY_TRANSPORT_IDENTIFIER: codeguard_audit; technical review only
    server.tool(
        "codeguard_audit",
        "LLM-assisted technical framework review of supplied source; heuristic, non-authoritative findings or UNKNOWN, never legal compliance or certification",
        {
            region: z.enum(["BR", "EU"]).describe("Reference-topic region; no legal applicability inferred"),
            frameworks: z.array(z.string()).describe("Specific Framework IDs"),
            filePath: z.string().optional().describe("Optional: Specific path to scan")
        },
        async (args) => {
            const result = await dispatcher.dispatch('codeguard_audit', args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                isError: !!result.error
            };
        }
    );

    // 2. Tool: Repo Intelligence Graph
    server.tool(
        "codeguard_graph",
        "Generates Dependency & Sensitivity Graph using Repo Intelligence Layer",
        {
            filePath: z.string().optional().describe("Optional: Target directory for graph generation")
        },
        async (args) => {
            const result = await dispatcher.dispatch('codeguard_graph', args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                isError: !!result.error
            };
        }
    );

    // 3. Tool: Shadow API Detector
    server.tool(
        "detect_shadow_apis",
        "Detects undocumented API endpoints and security risks in source code",
        {
            content: z.string().optional().describe("Direct code content to analyze"),
            filePath: z.string().optional().describe("File path or directory to scan")
        },
        async (args) => {
            const result = await dispatcher.dispatch('detect_shadow_apis', args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                isError: !!result.error
            };
        }
    );

    return server;
}

// --- BOOTSTRAP TRANSPORTS ---

/**
 * Runner for Local Stdio Transport (Standard for Desktop tools like Cursor)
 */
async function runStdio() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("CodeGuard MCP | Stdio Mode | Listening...");
}

/**
 * Runner for Remote SSE Transport (Standard for Cloud tools like Replit)
 */
async function runSse() {
    const app = express();
    const server = createMcpServer();
    
    // Auth Middleware for SSE
    app.use((req, res, next) => {
        const auth = UnifiedAuthenticator.authenticate(req.headers.authorization as string || req.headers['x-api-key'] as string);
        if (!auth.authenticated) {
            return res.status(401).json({ error: "Unauthorized", message: "Valid API Key required for SSE connection" });
        }
        UnifiedAuthenticator.logAccess(req.method, req.path, auth.fingerprint!);
        next();
    });

    let sseTransport: SSEServerTransport | null = null;

    app.get("/sse", async (req, res) => {
        console.error("[SSE] New connection request");
        sseTransport = new SSEServerTransport("/message", res);
        await server.connect(sseTransport);
    });

    app.post("/message", express.json(), async (req, res) => {
        if (!sseTransport) {
            return res.status(400).send("No active SSE session");
        }
        await sseTransport.handlePostMessage(req, res);
    });

    app.listen(PORT, () => {
        console.error(`CodeGuard MCP | SSE Mode | Listening on port ${PORT}`);
        console.error(`Endpoints: GET /sse, POST /message`);
    });
}

// --- MAIN ---
async function main() {
    const mode = (process.env.TRANSPORT_MODE || 'stdio').toLowerCase();
    
    if (mode === 'stdio') {
        await runStdio();
    } else if (mode === 'sse') {
        await runSse();
    } else {
        console.error(`Invalid TRANSPORT_MODE: ${mode}. Use 'stdio' or 'sse'.`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("[FATAL ERROR]", err);
    process.exit(1);
});

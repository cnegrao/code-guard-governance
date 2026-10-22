import { technicalReviewSchemas } from './review-schema';
// Node.js Runtime for Vercel
export const runtime = 'nodejs';

export async function GET(request: Request) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization'
    };

    try {
        const openapiSpec = {
            openapi: "3.0.3",
            info: {
                title: "CodeGuard AI API",
                description: "REST API for non-authoritative technical framework review of supplied source code",
                version: "1.2.0",
                contact: {
                    name: "CodeGuard AI Support",
                    url: "https://code-guard.eu",
                    email: "support@code-guard.eu"
                }
            },
            servers: [
                {
                    url: "https://code-guard.eu",
                    description: "Production server"
                }
            ],
            security: [
                {
                    ApiKeyAuth: []
                }
            ],
            paths: {
                "/api/scan": {
                    post: {
                        summary: "Run technical framework review",
                        description: "LLM-assisted technical findings associated with selected reference topics; no legal compliance or certification determination. LEGACY_TRANSPORT_IDENTIFIER: /api/scan and operationId scanCompliance.",
                        operationId: "scanCompliance",
                        requestBody: {
                            required: true,
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        required: ["region"],
                                        properties: {
                                            region: {
                                                type: "string",
                                                enum: ["BR", "EU"],
                                                description: "Reference-topic region; no legal applicability inferred"
                                            },
                                            frameworks: {
                                                type: "array",
                                                items: { type: "string" },
                                                description: "Specific framework IDs to check"
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        responses: {
                            "200": {
                                description: "Technical review returned; per-framework UNKNOWN may remain",
                                content: {
                                    "application/json": {
                                        schema: { $ref: "#/components/schemas/ScanResult" }
                                    }
                                }
                            }
                        }
                    }
                },
                "/api/v1/scan": {
                "post": {
                                "summary": "Review supplied source code",
                                "description": "LEGACY_TRANSPORT_IDENTIFIER /api/v1/scan. Heuristic technical review only; no legal applicability or framework satisfaction determination.",
                                "responses": {
                                                "200": {
                                                                "description": "Technical result; HTTP success is not a framework conclusion",
                                                                "content": {
                                                                                "application/json": {
                                                                                                "schema": {
                                                                                                                "$ref": "#/components/schemas/V1ScanResult"
                                                                                                }
                                                                                }
                                                                }
                                                }
                                }
                }
},
                "/api/graph": {
                    post: {
                        summary: "Generate dependency graph",
                        description: "Generate repository intelligence graph showing dependencies and sensitive data flows",
                        operationId: "generateGraph",
                        responses: {
                            "200": {
                                description: "Graph generated successfully",
                                content: {
                                    "application/json": {
                                        schema: { $ref: "#/components/schemas/GraphResult" }
                                    }
                                }
                            }
                        }
                    }
                },
                "/api/shadow-apis": {
                    post: {
                        summary: "Detect shadow APIs",
                        description: "Scan code for undocumented API endpoints and security risks",
                        operationId: "detectShadowAPIs",
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            content: {
                                                type: "string",
                                                description: "Code content to analyze"
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        responses: {
                            "200": {
                                description: "Shadow API scan completed",
                                content: {
                                    "application/json": {
                                        schema: { $ref: "#/components/schemas/ShadowAPIResult" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            components: {
                securitySchemes: {
                    ApiKeyAuth: {
                        type: "apiKey",
                        in: "header",
                        name: "x-api-key"
                    }
                },
                schemas: {
                    ...technicalReviewSchemas,
                    GraphResult: {
                        type: "object",
                        properties: {
                            content: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        type: { type: "string", enum: ["text"] },
                                        text: { type: "string" }
                                    }
                                }
                            }
                        }
                    },
                    ShadowAPIResult: {
                        type: "object",
                        properties: {
                            content: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        type: { type: "string", enum: ["text"] },
                                        text: { type: "string" }
                                    }
                                }
                            },
                            isError: { type: "boolean" }
                        }
                    }
                }
            }
        };

        return new Response(JSON.stringify(openapiSpec, null, 2), { 
            status: 200, 
            headers 
        });

    } catch (error) {
        console.error('[API Error]', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
    }
}

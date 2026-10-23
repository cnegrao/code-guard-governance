/** Closed non-authoritative deep-review schemas shared by the public OpenAPI endpoint. */
export const technicalReviewSchemas = {
    "AnalysisBoundary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "kind",
            "authority",
            "legal_conclusion",
            "compliance_determination",
            "framework_satisfaction",
            "control_effectiveness",
            "certification",
            "attestation",
            "assurance"
        ],
        "properties": {
            "kind": {
                "type": "string",
                "enum": [
                    "LLM_ASSISTED_TECHNICAL_FRAMEWORK_REVIEW"
                ]
            },
            "authority": {
                "type": "string",
                "enum": [
                    "HEURISTIC_NON_AUTHORITATIVE"
                ]
            },
            "legal_conclusion": {
                "type": "boolean",
                "enum": [
                    false
                ]
            },
            "compliance_determination": {
                "type": "boolean",
                "enum": [
                    false
                ]
            },
            "framework_satisfaction": {
                "type": "boolean",
                "enum": [
                    false
                ]
            },
            "control_effectiveness": {
                "type": "boolean",
                "enum": [
                    false
                ]
            },
            "certification": {
                "type": "boolean",
                "enum": [
                    false
                ]
            },
            "attestation": {
                "type": "boolean",
                "enum": [
                    false
                ]
            },
            "assurance": {
                "type": "boolean",
                "enum": [
                    false
                ]
            }
        }
    },
    "ReviewAcquisition": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "state",
            "read_failures",
            "excluded_files",
            "truncated_files"
        ],
        "properties": {
            "state": {
                "type": "string",
                "enum": [
                    "COMPLETE",
                    "PARTIAL",
                    "UNKNOWN"
                ]
            },
            "read_failures": {
                "type": "integer",
                "minimum": 0
            },
            "excluded_files": {
                "type": "integer",
                "minimum": 0
            },
            "truncated_files": {
                "type": "integer",
                "minimum": 0
            }
        }
    },
    "TechnicalFrameworkFinding": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "file_path",
            "line_start",
            "line_end",
            "technical_observation",
            "severity",
            "recommendation"
        ],
        "properties": {
            "file_path": {
                "type": "string"
            },
            "line_start": {
                "type": "integer",
                "minimum": 1
            },
            "line_end": {
                "type": "integer",
                "minimum": 1
            },
            "technical_observation": {
                "type": "string"
            },
            "severity": {
                "type": "string",
                "enum": [
                    "High",
                    "Medium",
                    "Low"
                ]
            },
            "recommendation": {
                "type": "string"
            },
            "reference_hint": {
                "type": "string"
            },
            "code_fix": {
                "type": "string"
            }
        },
        "description": "Untrusted model-generated potential engineering observation. Reference hints do not establish applicability, violation or satisfaction."
    },
    "FrameworkReviewResult": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "analysis_boundary",
            "framework",
            "frameworkName",
            "analysis_state",
            "completeness",
            "findings",
            "summary",
            "limitations",
            "batches",
            "failures",
            "source_files",
            "llm_used",
            "execution_time_ms"
        ],
        "properties": {
            "analysis_boundary": {
                "$ref": "#/components/schemas/AnalysisBoundary"
            },
            "framework": {
                "type": "string"
            },
            "frameworkName": {
                "type": "string"
            },
            "analysis_state": {
                "type": "string",
                "enum": [
                    "FINDINGS_DETECTED",
                    "NO_FINDINGS_DETECTED",
                    "UNKNOWN"
                ]
            },
            "completeness": {
                "type": "string",
                "enum": [
                    "COMPLETE",
                    "PARTIAL",
                    "UNKNOWN"
                ]
            },
            "findings": {
                "type": "array",
                "items": {
                    "$ref": "#/components/schemas/TechnicalFrameworkFinding"
                }
            },
            "summary": {
                "type": "string"
            },
            "limitations": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "batches": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                    "required",
                    "analyzed",
                    "failed"
                ],
                "properties": {
                    "required": {
                        "type": "integer",
                        "minimum": 0
                    },
                    "analyzed": {
                        "type": "integer",
                        "minimum": 0
                    },
                    "failed": {
                        "type": "integer",
                        "minimum": 0
                    }
                }
            },
            "failures": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "batch_index",
                        "reason"
                    ],
                    "properties": {
                        "batch_index": {
                            "type": "integer",
                            "nullable": true
                        },
                        "reason": {
                            "type": "string",
                            "enum": [
                                "MODEL_FAILURE",
                                "MALFORMED_OUTPUT",
                                "UNSUPPORTED_OUTPUT",
                                "MODEL_UNCERTAINTY",
                                "ACQUISITION_INCOMPLETE",
                                "ANALYSIS_FAILURE"
                            ]
                        }
                    }
                }
            },
            "source_files": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "llm_used": {
                "type": "string"
            },
            "execution_time_ms": {
                "type": "integer",
                "minimum": 0
            }
        },
        "description": "NO_FINDINGS_DETECTED requires every declared-input batch to complete, and does not establish framework satisfaction or legal compliance. Findings can coexist with PARTIAL completeness. UNKNOWN is not a framework failure."
    },
    "TechnicalFrameworkReviewResult": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "analysis_boundary",
            "region",
            "frameworks_requested",
            "frameworks_analyzed",
            "frameworks_unknown",
            "total_findings",
            "high_priority_findings",
            "results",
            "files_analyzed",
            "source_files",
            "acquisition",
            "limitations",
            "total_tokens_used",
            "execution_time_ms",
            "timestamp"
        ],
        "properties": {
            "analysis_boundary": {
                "$ref": "#/components/schemas/AnalysisBoundary"
            },
            "region": {
                "type": "string",
                "enum": [
                    "BR",
                    "EU",
                    "US",
                    "GLOBAL"
                ]
            },
            "frameworks_requested": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "frameworks_analyzed": {
                "type": "integer",
                "minimum": 0
            },
            "frameworks_unknown": {
                "type": "integer",
                "minimum": 0
            },
            "total_findings": {
                "type": "integer",
                "minimum": 0
            },
            "high_priority_findings": {
                "type": "integer",
                "minimum": 0
            },
            "results": {
                "type": "array",
                "items": {
                    "$ref": "#/components/schemas/FrameworkReviewResult"
                }
            },
            "files_analyzed": {
                "type": "integer",
                "minimum": 0
            },
            "source_files": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "acquisition": {
                "$ref": "#/components/schemas/ReviewAcquisition"
            },
            "limitations": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "total_tokens_used": {
                "type": "integer",
                "minimum": 0
            },
            "execution_time_ms": {
                "type": "integer",
                "minimum": 0
            },
            "timestamp": {
                "type": "string"
            },
            "metadata": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                    "consultationDate"
                ],
                "properties": {
                    "clientName": {
                        "type": "string"
                    },
                    "repoUrl": {
                        "type": "string"
                    },
                    "consultationDate": {
                        "type": "string"
                    }
                }
            }
        },
        "description": "Bounded technical source review; counts are descriptive only. No aggregate framework attainment state. frameworks_analyzed counts COMPLETE reviews; frameworks_unknown counts incomplete/unknown reviews. files_analyzed is acquired file count, not framework coverage."
    },
    "ScanResult": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "success",
            "analysis_boundary",
            "region",
            "frameworks_requested",
            "frameworks_analyzed",
            "frameworks_unknown",
            "total_findings",
            "high_priority_findings",
            "results",
            "files_analyzed",
            "source_files",
            "acquisition",
            "limitations",
            "total_tokens_used",
            "execution_time_ms",
            "timestamp"
        ],
        "properties": {
            "success": {
                "type": "boolean",
                "enum": [
                    true
                ]
            },
            "analysis_boundary": {
                "$ref": "#/components/schemas/AnalysisBoundary"
            },
            "region": {
                "type": "string",
                "enum": [
                    "BR",
                    "EU",
                    "US",
                    "GLOBAL"
                ]
            },
            "frameworks_requested": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "frameworks_analyzed": {
                "type": "integer",
                "minimum": 0
            },
            "frameworks_unknown": {
                "type": "integer",
                "minimum": 0
            },
            "total_findings": {
                "type": "integer",
                "minimum": 0
            },
            "high_priority_findings": {
                "type": "integer",
                "minimum": 0
            },
            "results": {
                "type": "array",
                "items": {
                    "$ref": "#/components/schemas/FrameworkReviewResult"
                }
            },
            "files_analyzed": {
                "type": "integer",
                "minimum": 0
            },
            "source_files": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "acquisition": {
                "$ref": "#/components/schemas/ReviewAcquisition"
            },
            "limitations": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "total_tokens_used": {
                "type": "integer",
                "minimum": 0
            },
            "execution_time_ms": {
                "type": "integer",
                "minimum": 0
            },
            "timestamp": {
                "type": "string"
            },
            "metadata": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                    "consultationDate"
                ],
                "properties": {
                    "clientName": {
                        "type": "string"
                    },
                    "repoUrl": {
                        "type": "string"
                    },
                    "consultationDate": {
                        "type": "string"
                    }
                }
            }
        },
        "description": "LEGACY_TRANSPORT_IDENTIFIER /api/scan: flat technical result. success means tool execution only; individual frameworks may be UNKNOWN."
    },
    "V1ScanResult": {
        "type": "object",
        "additionalProperties": false,
        "required": [
            "success",
            "result",
            "usage"
        ],
        "properties": {
            "success": {
                "type": "boolean",
                "enum": [
                    true
                ]
            },
            "result": {
                "$ref": "#/components/schemas/TechnicalFrameworkReviewResult"
            },
            "usage": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                    "creditsUsed",
                    "tokensUsed",
                    "cost"
                ],
                "properties": {
                    "creditsUsed": {
                        "type": "integer",
                        "minimum": 0
                    },
                    "tokensUsed": {
                        "type": "integer",
                        "minimum": 0
                    },
                    "cost": {
                        "type": "number"
                    }
                }
            }
        },
        "description": "LEGACY_TRANSPORT_IDENTIFIER /api/v1/scan: wrapped technical result. success means HTTP/tool execution only."
    }
} as const;

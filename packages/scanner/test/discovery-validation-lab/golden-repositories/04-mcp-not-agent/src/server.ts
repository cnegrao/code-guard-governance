export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
}

export const lookupCatalog: McpToolDefinition = {
  name: "lookup_catalog",
  description: "Read a synthetic catalog entry",
};

export const listPolicies: McpToolDefinition = {
  name: "list_policies",
  description: "List synthetic policy identifiers",
};

export const customerMcpServer = {
  protocol: "mcp",
  serverIdentity: "synthetic-catalog-mcp",
  tools: [lookupCatalog, listPolicies],
};

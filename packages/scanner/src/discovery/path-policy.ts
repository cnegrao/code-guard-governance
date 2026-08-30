const DISCOVERY_LAB_RESERVED_SEGMENT = ".govia-lab";

/**
 * Returns true when a repository path enters the reserved Discovery Lab
 * namespace. Parent segments are intentionally not resolved so `..` cannot
 * hide an earlier `.govia-lab` segment from this safety check.
 */
export function isDiscoveryPathExcluded(path: string): boolean {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .some(
      (segment) =>
        segment.toLowerCase() === DISCOVERY_LAB_RESERVED_SEGMENT,
    );
}

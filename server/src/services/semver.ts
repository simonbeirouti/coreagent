type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
};

const semverCorePattern = /^(\d+)\.(\d+)\.(\d+)$/;

function parseCore(version: string): ParsedSemver | null {
  const normalized = version.trim();
  if (normalized.length === 0) {
    return null;
  }

  const core = normalized.split("+", 1)[0]?.split("-", 1)[0] ?? "";
  const match = semverCorePattern.exec(core);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1] ?? "", 10);
  const minor = Number.parseInt(match[2] ?? "", 10);
  const patch = Number.parseInt(match[3] ?? "", 10);
  if ([major, minor, patch].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { major, minor, patch };
}

export function isValidSemver(version: string): boolean {
  return parseCore(version) !== null;
}

export function compareSemver(left: string, right: string): number | null {
  const parsedLeft = parseCore(left);
  const parsedRight = parseCore(right);
  if (!parsedLeft || !parsedRight) {
    return null;
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major > parsedRight.major ? 1 : -1;
  }

  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor > parsedRight.minor ? 1 : -1;
  }

  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch > parsedRight.patch ? 1 : -1;
  }

  return 0;
}

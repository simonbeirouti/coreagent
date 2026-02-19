export type ArtifactScanInput = {
  digest: string;
  artifactBytes: Buffer;
  manifest: Record<string, unknown>;
};

export type ArtifactScanResult = {
  status: "clean" | "blocked";
  provider: string;
  reason?: string;
};

export type ArtifactScanner = {
  scan(input: ArtifactScanInput): Promise<ArtifactScanResult>;
};

export class NoopArtifactScanner implements ArtifactScanner {
  public async scan(input: ArtifactScanInput): Promise<ArtifactScanResult> {
    void input;
    return {
      status: "clean",
      provider: "noop"
    };
  }
}

const blockedSnippets = [
  "rm -rf /",
  "chmod 777 /",
  "169.254.169.254",
  "curl --silent --location http://",
  "Invoke-WebRequest http://"
];

export class HeuristicArtifactScanner implements ArtifactScanner {
  public async scan(input: ArtifactScanInput): Promise<ArtifactScanResult> {
    const previewText = input.artifactBytes.subarray(0, 128 * 1024).toString("utf8");
    const match = blockedSnippets.find((snippet) => previewText.includes(snippet));
    if (match) {
      return {
        status: "blocked",
        provider: "heuristic",
        reason: `Blocked suspicious snippet match: ${match}`
      };
    }

    return {
      status: "clean",
      provider: "heuristic"
    };
  }
}

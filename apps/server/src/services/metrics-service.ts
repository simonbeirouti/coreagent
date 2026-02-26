type CatalogRouteKey =
  | "GET /v1/skills"
  | "GET /v1/skills/:skillId"
  | "GET /v1/skills/:skillId/versions/:version"
  | "GET /v1/advisories"
  | "GET /v1/advisories/feed";

type CatalogRouteMetric = {
  requests: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
};

function createCatalogRouteMetric(): CatalogRouteMetric {
  return {
    requests: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0
  };
}

function toNonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export type ServiceMetricsSnapshot = {
  startedAt: string;
  uptimeSec: number;
  requests: {
    total: number;
    byStatusClass: {
      status2xx: number;
      status4xx: number;
      status5xx: number;
    };
  };
  catalog: {
    latencyByRoute: Record<
      CatalogRouteKey,
      {
        requests: number;
        avgLatencyMs: number;
        maxLatencyMs: number;
        status2xx: number;
        status4xx: number;
        status5xx: number;
      }
    >;
  };
  publish: {
    total: number;
    success: number;
    failure: number;
    successRate: number;
    validationFailures: number;
  };
  advisories: {
    publishedTotal: number;
    propagationLagMs: {
      samples: number;
      avg: number;
      max: number;
    };
    propagationFailures: number;
  };
  handshake: {
    latencyMs: {
      samples: number;
      avg: number;
      max: number;
    };
    failures: number;
  };
  runtimeGate: {
    blockedExecutionsByReason: Record<string, number>;
  };
};

export class MetricsService {
  private readonly startedAtMs = Date.now();
  private readonly startedAtIso = new Date(this.startedAtMs).toISOString();

  private requestTotal = 0;
  private request2xx = 0;
  private request4xx = 0;
  private request5xx = 0;

  private publishTotal = 0;
  private publishSuccess = 0;
  private publishFailure = 0;
  private validationFailureTotal = 0;

  private advisoryPublishedTotal = 0;
  private advisoryLagSamples = 0;
  private advisoryLagTotalMs = 0;
  private advisoryLagMaxMs = 0;
  private advisoryPropagationFailures = 0;
  private handshakeLatencySamples = 0;
  private handshakeLatencyTotalMs = 0;
  private handshakeLatencyMaxMs = 0;
  private handshakeFailures = 0;
  private readonly blockedExecutionCounts = new Map<string, number>();

  private readonly catalogByRoute: Record<CatalogRouteKey, CatalogRouteMetric> = {
    "GET /v1/skills": createCatalogRouteMetric(),
    "GET /v1/skills/:skillId": createCatalogRouteMetric(),
    "GET /v1/skills/:skillId/versions/:version": createCatalogRouteMetric(),
    "GET /v1/advisories": createCatalogRouteMetric(),
    "GET /v1/advisories/feed": createCatalogRouteMetric()
  };

  public recordHttpRequest(statusCode: number): void {
    this.requestTotal += 1;
    if (statusCode >= 500) {
      this.request5xx += 1;
      return;
    }
    if (statusCode >= 400) {
      this.request4xx += 1;
      return;
    }
    if (statusCode >= 200 && statusCode < 300) {
      this.request2xx += 1;
    }
  }

  public recordCatalogLatency(route: CatalogRouteKey, statusCode: number, latencyMs: number): void {
    const metric = this.catalogByRoute[route];
    metric.requests += 1;
    const normalizedLatencyMs = toNonNegativeNumber(latencyMs);
    metric.totalLatencyMs += normalizedLatencyMs;
    metric.maxLatencyMs = Math.max(metric.maxLatencyMs, normalizedLatencyMs);
    if (statusCode >= 500) {
      metric.status5xx += 1;
      return;
    }
    if (statusCode >= 400) {
      metric.status4xx += 1;
      return;
    }
    if (statusCode >= 200 && statusCode < 300) {
      metric.status2xx += 1;
    }
  }

  public recordPublishAttempt(success: boolean): void {
    this.publishTotal += 1;
    if (success) {
      this.publishSuccess += 1;
    } else {
      this.publishFailure += 1;
    }
  }

  public recordValidationFailure(): void {
    this.validationFailureTotal += 1;
  }

  public recordAdvisoryPublished(): void {
    this.advisoryPublishedTotal += 1;
  }

  public recordAdvisoryPropagationLagMs(lagMs: number): void {
    const normalizedLagMs = toNonNegativeNumber(lagMs);
    this.advisoryLagSamples += 1;
    this.advisoryLagTotalMs += normalizedLagMs;
    this.advisoryLagMaxMs = Math.max(this.advisoryLagMaxMs, normalizedLagMs);
  }

  public recordAdvisoryPropagationFailure(): void {
    this.advisoryPropagationFailures += 1;
  }

  public recordHandshakeLatencyMs(latencyMs: number): void {
    const normalizedLatencyMs = toNonNegativeNumber(latencyMs);
    this.handshakeLatencySamples += 1;
    this.handshakeLatencyTotalMs += normalizedLatencyMs;
    this.handshakeLatencyMaxMs = Math.max(this.handshakeLatencyMaxMs, normalizedLatencyMs);
  }

  public recordHandshakeFailure(): void {
    this.handshakeFailures += 1;
  }

  public recordBlockedExecution(reason: string): void {
    const normalizedReason = reason.trim().length > 0 ? reason.trim() : "unknown";
    const existing = this.blockedExecutionCounts.get(normalizedReason) ?? 0;
    this.blockedExecutionCounts.set(normalizedReason, existing + 1);
  }

  public snapshot(): ServiceMetricsSnapshot {
    const nowMs = Date.now();
    const uptimeSec = Math.max(0, Math.floor((nowMs - this.startedAtMs) / 1000));
    const publishSuccessRate = this.publishTotal > 0 ? this.publishSuccess / this.publishTotal : 0;

    return {
      startedAt: this.startedAtIso,
      uptimeSec,
      requests: {
        total: this.requestTotal,
        byStatusClass: {
          status2xx: this.request2xx,
          status4xx: this.request4xx,
          status5xx: this.request5xx
        }
      },
      catalog: {
        latencyByRoute: {
          "GET /v1/skills": {
            requests: this.catalogByRoute["GET /v1/skills"].requests,
            avgLatencyMs:
              this.catalogByRoute["GET /v1/skills"].requests > 0
                ? this.catalogByRoute["GET /v1/skills"].totalLatencyMs /
                  this.catalogByRoute["GET /v1/skills"].requests
                : 0,
            maxLatencyMs: this.catalogByRoute["GET /v1/skills"].maxLatencyMs,
            status2xx: this.catalogByRoute["GET /v1/skills"].status2xx,
            status4xx: this.catalogByRoute["GET /v1/skills"].status4xx,
            status5xx: this.catalogByRoute["GET /v1/skills"].status5xx
          },
          "GET /v1/skills/:skillId": {
            requests: this.catalogByRoute["GET /v1/skills/:skillId"].requests,
            avgLatencyMs:
              this.catalogByRoute["GET /v1/skills/:skillId"].requests > 0
                ? this.catalogByRoute["GET /v1/skills/:skillId"].totalLatencyMs /
                  this.catalogByRoute["GET /v1/skills/:skillId"].requests
                : 0,
            maxLatencyMs: this.catalogByRoute["GET /v1/skills/:skillId"].maxLatencyMs,
            status2xx: this.catalogByRoute["GET /v1/skills/:skillId"].status2xx,
            status4xx: this.catalogByRoute["GET /v1/skills/:skillId"].status4xx,
            status5xx: this.catalogByRoute["GET /v1/skills/:skillId"].status5xx
          },
          "GET /v1/skills/:skillId/versions/:version": {
            requests: this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].requests,
            avgLatencyMs:
              this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].requests > 0
                ? this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].totalLatencyMs /
                  this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].requests
                : 0,
            maxLatencyMs: this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].maxLatencyMs,
            status2xx: this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].status2xx,
            status4xx: this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].status4xx,
            status5xx: this.catalogByRoute["GET /v1/skills/:skillId/versions/:version"].status5xx
          },
          "GET /v1/advisories": {
            requests: this.catalogByRoute["GET /v1/advisories"].requests,
            avgLatencyMs:
              this.catalogByRoute["GET /v1/advisories"].requests > 0
                ? this.catalogByRoute["GET /v1/advisories"].totalLatencyMs /
                  this.catalogByRoute["GET /v1/advisories"].requests
                : 0,
            maxLatencyMs: this.catalogByRoute["GET /v1/advisories"].maxLatencyMs,
            status2xx: this.catalogByRoute["GET /v1/advisories"].status2xx,
            status4xx: this.catalogByRoute["GET /v1/advisories"].status4xx,
            status5xx: this.catalogByRoute["GET /v1/advisories"].status5xx
          },
          "GET /v1/advisories/feed": {
            requests: this.catalogByRoute["GET /v1/advisories/feed"].requests,
            avgLatencyMs:
              this.catalogByRoute["GET /v1/advisories/feed"].requests > 0
                ? this.catalogByRoute["GET /v1/advisories/feed"].totalLatencyMs /
                  this.catalogByRoute["GET /v1/advisories/feed"].requests
                : 0,
            maxLatencyMs: this.catalogByRoute["GET /v1/advisories/feed"].maxLatencyMs,
            status2xx: this.catalogByRoute["GET /v1/advisories/feed"].status2xx,
            status4xx: this.catalogByRoute["GET /v1/advisories/feed"].status4xx,
            status5xx: this.catalogByRoute["GET /v1/advisories/feed"].status5xx
          }
        }
      },
      publish: {
        total: this.publishTotal,
        success: this.publishSuccess,
        failure: this.publishFailure,
        successRate: publishSuccessRate,
        validationFailures: this.validationFailureTotal
      },
      advisories: {
        publishedTotal: this.advisoryPublishedTotal,
        propagationLagMs: {
          samples: this.advisoryLagSamples,
          avg: this.advisoryLagSamples > 0 ? this.advisoryLagTotalMs / this.advisoryLagSamples : 0,
          max: this.advisoryLagMaxMs
        },
        propagationFailures: this.advisoryPropagationFailures
      },
      handshake: {
        latencyMs: {
          samples: this.handshakeLatencySamples,
          avg: this.handshakeLatencySamples > 0 ? this.handshakeLatencyTotalMs / this.handshakeLatencySamples : 0,
          max: this.handshakeLatencyMaxMs
        },
        failures: this.handshakeFailures
      },
      runtimeGate: {
        blockedExecutionsByReason: Object.fromEntries(
          [...this.blockedExecutionCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
        )
      }
    };
  }
}

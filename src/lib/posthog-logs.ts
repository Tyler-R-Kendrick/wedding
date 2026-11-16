import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';

type LogAttributes = Record<string, boolean | number | string>;

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let provider: LoggerProvider | undefined;
let configured = false;
let warned = false;

function warnMissingConfiguration() {
  if (warned || process.env.NODE_ENV === 'production') return;
  warned = true;
  const missingVariable = token ? 'NEXT_PUBLIC_POSTHOG_HOST' : 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN';
  console.warn(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
}

function getProvider(): LoggerProvider | undefined {
  if (configured) return provider;
  configured = true;

  if (!token || !host) {
    warnMissingConfiguration();
    return undefined;
  }

  try {
    provider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': 'wedding',
        'deployment.environment': process.env.NODE_ENV ?? 'development',
      }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: new URL('/i/v1/logs', host).toString(),
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }),
        }),
      ],
    });

    // This logger is intentionally not registered globally: only records emitted below leave the app.
    process.once('beforeExit', () => {
      void provider?.shutdown().catch(() => undefined);
    });

    return provider;
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('PostHog log capture could not be configured; no dedicated logs will be exported.');
    }
    return undefined;
  }
}

export function emitPostHogLog(
  body: string,
  severityNumber: SeverityNumber,
  attributes: LogAttributes,
) {
  const logProvider = getProvider();
  if (!logProvider) return;

  logProvider.getLogger('wedding.posthog').emit({
    body,
    severityNumber,
    attributes,
  });
}

export const posthogLogSeverity = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
} as const;

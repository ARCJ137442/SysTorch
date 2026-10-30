import { useState } from 'react';
import { ChevronDown, CircleCheck, CircleX, LoaderCircle, SkipForward } from 'lucide-react';
import { getActivityByRequestId } from '../../api/access';
import { useI18n } from '../../i18n';

type TraceObject = Record<string, unknown>;

function asRecord(value: unknown): TraceObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as TraceObject
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function traceFromEventDetail(detail: string, requestId: string): TraceObject | null {
  try {
    const parsed = asRecord(JSON.parse(detail));
    if (!parsed || parsed.request_id !== requestId) return null;
    return asRecord(parsed.route_trace);
  } catch {
    return null;
  }
}

function outcomeName(outcome: string | null, t: ReturnType<typeof useI18n>['t']): string {
  if (outcome === 'succeeded' || outcome === 'success') return t('decision.traceSucceeded');
  if (outcome === 'failed' || outcome === 'failure') return t('decision.traceFailed');
  if (outcome === 'skipped') return t('decision.traceSkipped');
  return t('decision.traceUnknown');
}

function outcomeClass(outcome: string | null): string {
  if (outcome === 'succeeded' || outcome === 'success') return 'succeeded';
  if (outcome === 'failed' || outcome === 'failure') return 'failed';
  return 'other';
}

export function RouteTraceDisclosure({ requestId, initialTrace }: { requestId?: string | null; initialTrace?: unknown }) {
  const { t } = useI18n();
  const initial = asRecord(initialTrace);
  const [expanded, setExpanded] = useState(false);
  const [trace, setTrace] = useState<TraceObject | null>(initial);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(initial !== null);
  const [loadFailed, setLoadFailed] = useState(false);
  const attempts = Array.isArray(trace?.attempts) ? trace.attempts.map(asRecord).filter((item): item is TraceObject => item !== null) : [];

  const loadTrace = async (force = false) => {
    if (!requestId || loading || (loaded && !force)) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const page = await getActivityByRequestId(requestId);
      const matching = page.events.find(event => typeof event.detail === 'string' && Boolean(traceFromEventDetail(event.detail, requestId)));
      const result = matching ? traceFromEventDetail(matching.detail, requestId) : null;
      setTrace(result);
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded && !loading) void loadTrace();
  };

  return <section className="decision-route-trace">
    <button type="button" className="decision-route-trace__toggle" aria-expanded={expanded} onClick={toggle}>
      <span>{t('decision.routeTrace')}{attempts.length > 0 ? ` · ${attempts.length} ${t('decision.upstreamAttempts')}` : ''}</span>
      <ChevronDown size={15} aria-hidden="true"/>
    </button>
    {expanded && <div className="decision-route-trace__body">
      {loading && <p className="decision-route-trace__state" role="status"><LoaderCircle className="decision-spinner" size={14}/>{t('decision.traceLoading')}</p>}
      {loadFailed && <div className="decision-route-trace__state" role="status"><span>{t('decision.traceLoadFailed')}</span><button type="button" onClick={() => { setLoaded(false); void loadTrace(true); }}>{t('decision.traceRetry')}</button></div>}
      {!loading && !loadFailed && !trace && <p className="decision-route-trace__state">{t('decision.traceUnavailable')}</p>}
      {trace && <>
        {(text(trace.requested_model) || text(trace.selected_provider) || text(trace.selected_model)) && <p className="decision-route-trace__summary">
          {text(trace.requested_model) && <span>{t('decision.traceRequested')}: {text(trace.requested_model)}</span>}
          {text(trace.selected_provider) && <span>{t('decision.traceSelected')}: {text(trace.selected_provider)}{text(trace.selected_model) ? ` · ${text(trace.selected_model)}` : ''}</span>}
        </p>}
        {attempts.length > 0 ? <ol className="decision-route-trace__attempts">
          {attempts.map((attempt, index) => {
            const outcome = text(attempt.outcome);
            const status = number(attempt.upstream_status);
            const latency = number(attempt.latency_ms);
            const provider = text(attempt.provider_id) ?? text(attempt.provider) ?? t('decision.traceUnknownProvider');
            const model = text(attempt.upstream_model);
            const hops = Array.isArray(attempt.hops) ? attempt.hops.filter((hop): hop is string => typeof hop === 'string') : [];
            const Icon = outcomeClass(outcome) === 'succeeded' ? CircleCheck : outcomeClass(outcome) === 'failed' ? CircleX : SkipForward;
            return <li className="decision-route-trace__attempt" key={`${provider}-${index}`}>
              <div className="decision-route-trace__attempt-heading">
                <strong>{index + 1}. {provider}{model ? ` · ${model}` : ''}</strong>
                <span className={`decision-route-trace__outcome is-${outcomeClass(outcome)}`}><Icon size={13} aria-hidden="true"/>{outcomeName(outcome, t)}</span>
              </div>
              <div className="decision-route-trace__facts">
                {status !== null && <span>{t('decision.traceHttpStatus')} {status}</span>}
                {latency !== null && <span>{latency} ms</span>}
                {text(attempt.error_kind) && <span>{t('decision.traceErrorKind')}: {text(attempt.error_kind)}</span>}
                {text(attempt.retry_decision) && <span>{t('decision.traceNext')}: {text(attempt.retry_decision)}</span>}
                {hops.length > 0 && <span>{t('decision.tracePath')}: {hops.join(' → ')}</span>}
              </div>
            </li>;
          })}
        </ol> : <p className="decision-route-trace__state">{t('decision.traceNoAttempts')}</p>}
        <details className="decision-route-trace__raw"><summary>{t('decision.traceRaw')}</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details>
      </>}
    </div>}
  </section>;
}

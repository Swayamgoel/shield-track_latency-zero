import type { DeviationAlert, SOSEvent } from '@shieldtrack/types';

export type AlertKind = 'sos' | 'deviation';

export type AlertFeedItem =
  | { kind: 'sos'; data: SOSEvent }
  | { kind: 'deviation'; data: DeviationAlert };

type AlertListener = (alerts: AlertFeedItem[]) => void;

const alertsByKey = new Map<string, AlertFeedItem>();
const listeners = new Set<AlertListener>();

function toKey(kind: AlertKind, id: string): string {
  return `${kind}:${id}`;
}

function toTimestamp(alert: AlertFeedItem): number {
  return Date.parse(alert.data.triggered_at);
}

function sortedSnapshot(): AlertFeedItem[] {
  return Array.from(alertsByKey.values()).sort((a, b) => toTimestamp(b) - toTimestamp(a));
}

function emit(): void {
  const snapshot = sortedSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function getAlertCacheSnapshot(limit?: number): AlertFeedItem[] {
  const snapshot = sortedSnapshot();
  if (typeof limit === 'number' && limit > 0) {
    return snapshot.slice(0, limit);
  }
  return snapshot;
}

export function upsertAlert(alert: AlertFeedItem): void {
  alertsByKey.set(toKey(alert.kind, alert.data.id), alert);
  emit();
}

export function upsertAlerts(alerts: AlertFeedItem[]): void {
  for (const alert of alerts) {
    alertsByKey.set(toKey(alert.kind, alert.data.id), alert);
  }
  emit();
}

export function subscribeAlertCache(listener: AlertListener): () => void {
  listeners.add(listener);
  listener(getAlertCacheSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

import { useEffect } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { isAndroidTauri, takePendingAndroidGatewayToggle } from '../api/androidGateway';
import { getGatewayServiceStatus, setGatewayServiceRunning } from '../api/gatewayControl';
import { useI18n } from '../i18n';
import { useToast } from './feedback';
import { createGatewayIntentDrain } from './gatewayIntentDrain';

const consume = createGatewayIntentDrain({
  takePending: takePendingAndroidGatewayToggle,
  readStatus: getGatewayServiceStatus,
  setRunning: setGatewayServiceRunning,
});

export function AndroidGatewayIntents() {
  const { toast } = useToast();
  const { t } = useI18n();
  useEffect(() => {
    if (!isAndroidTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const handle = () => {
      if (!active) return;
      void consume().then(status => {
        if (active && status) toast('ok', t(status.running ? 'gateway.localRunning' : 'gateway.localStopped'));
      }).catch(error => {
        if (active) toast('danger', `${t('gateway.localControlError')}: ${String(error)}`);
      });
    };
    // The installed Kotlin SDK exposes camelCase commands. Use its channel
    // contract explicitly; generic SDK cleanup only calls remove_listener.
    const plugin = 'plugin:systorch-android-keepalive';
    const event = 'jev-switch-gateway-toggle';
    const channel = new Channel(handle);
    void invoke(`${plugin}|registerListener`, { event, handler: channel }).then(() => {
      const stop = () => { void invoke(`${plugin}|removeListener`, { event, channelId: channel.id }).catch(error => console.warn('gateway listener cleanup failed', error)); };
      if (active) { unlisten = stop; handle(); }
      else stop();
    }).catch(error => {
      if (active) toast('danger', `${t('gateway.localControlError')}: ${String(error)}`);
    });
    // Already accepted gestures continue in the application-level drain; only
    // feedback and future event subscriptions belong to this React lifetime.
    return () => { active = false; unlisten?.(); };
  }, [t, toast]);
  return null;
}
